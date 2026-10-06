import {
  ForgecyError,
  providerIds,
  type Actor,
  type ConfidenceLevel,
  type ImportFileKind,
} from "@forgecy/core";
import type { AiGateway } from "@forgecy/ai";
import {
  and,
  eq,
  inArray,
  ne,
  productImportFiles,
  productImportItems,
  productImports,
  products,
  recordAuditEvent,
  type Database,
} from "@forgecy/db";
import type { StorageDriver } from "@forgecy/files";
import type { z } from "zod";
import {
  IMAGE_MATCH_SYSTEM,
  imageMatchInput,
  imageSuggestionSchema,
  MAPPING_SYSTEM,
  mappingInput,
  mappingProposalSchema,
  PDF_EXTRACTION_SYSTEM,
  pdfExtractionInput,
  pdfExtractionSchema,
  type ExtractedProduct,
} from "./ai";
import {
  candidateKey,
  matchMaterial,
  mergeCandidates,
  type Candidate,
  type MaterialFile,
} from "./candidates";
import { parseProductText, readTextDocument } from "./documents";
import { isImportError } from "./errors";
import {
  fieldKeys,
  isEmptyValue,
  sameValue,
  sanitizeDraft,
  type FieldKey,
  type ProductDraft,
} from "./fields";
import {
  importOptions,
  loadCatalogClient,
  type CatalogClient,
  type ImportFileRow,
  type ImportOptions,
} from "./imports";
import {
  inspectFile,
  sniffByName,
  sniffEntry,
  type FileMeta,
  type MappingProposalData,
} from "./inspect";
import type { ImportPhase } from "./jobs";
import { IMPORT_LIMITS } from "./limits";
import { applyMapping, columnMappingSchema } from "./mapping";
import {
  confidenceFor,
  lowestConfidence,
  type FieldMeta,
  type FieldMetaMap,
  type SourceRef,
} from "./meta";
import { chunkPages, readPdfText } from "./pdf";
import { rowToFields } from "./products";
import { sensitiveFields, type ClaimKind } from "./sensitive";
import { parseSheet } from "./sheet";
import { aiAvailability, proposeRoute } from "./sniff";
import { downloadToTemp, readStored, storeBuffer } from "./storage";
import { normalizeKey, normalizeSku } from "./text";
import { readZip } from "./zip";

export interface PipelineDeps {
  db: Database;
  storage: StorageDriver;
  /** Null when no provider is configured: the import falls back to the non-AI paths. */
  ai: AiGateway | null;
  localModelConfigured: boolean;
  logger?: {
    info(o: Record<string, unknown>, m?: string): void;
    warn(o: Record<string, unknown>, m?: string): void;
  };
}

export interface PipelineContext {
  jobId?: string;
  progress?(percent: number): Promise<void>;
  heartbeat?(): Promise<void>;
  isCancelled?(): Promise<boolean>;
}

interface Warning {
  code: string;
  message: string;
  fileId?: string;
}

const BRAND_ANALYST: Actor = { type: "agent", role: "brand_analyst" };

/** Entry point of the job: one phase of one import. */
export async function runImportPhase(
  deps: PipelineDeps,
  importId: string,
  phase: ImportPhase,
  ctx: PipelineContext = {},
) {
  const [imp] = await deps.db.select().from(productImports).where(eq(productImports.id, importId));
  if (!imp) throw new ForgecyError("not_found", "Import not found");
  if (imp.status !== "analyzing") return { skipped: true, status: imp.status };
  const client = await loadCatalogClient(deps.db, imp.clientId);
  const options = importOptions(imp);
  const ai = aiAvailability(client.aiPolicy, deps.localModelConfigured);
  const run: Run = {
    deps,
    ctx,
    importId,
    client,
    options,
    aiAllowed: ai.available && deps.ai !== null,
    aiReason:
      ai.reason ??
      (deps.ai
        ? undefined
        : "No AI provider configured: using manual mapping, matching by file name and SKU, and PDFs as sources."),
    createdBy: imp.createdBy,
    warnings: [],
    costMicroUsd: 0,
  };
  if (phase === "scan") {
    const needsMapping = await scan(run);
    if (needsMapping) return { status: "needs_mapping" };
  }
  return extract(run);
}

interface Run {
  deps: PipelineDeps;
  ctx: PipelineContext;
  importId: string;
  client: CatalogClient;
  options: ImportOptions;
  aiAllowed: boolean;
  aiReason?: string;
  createdBy: string | null;
  warnings: Warning[];
  costMicroUsd: number;
}

async function files(run: Run): Promise<ImportFileRow[]> {
  return run.deps.db
    .select()
    .from(productImportFiles)
    .where(eq(productImportFiles.importId, run.importId));
}

/** Gateway call with the client's policy; problems become warnings, never a silent fallback to cloud. */
async function callAi<T>(
  run: Run,
  req: {
    system: string;
    input: string;
    schema: z.ZodType<T>;
    fileId?: string;
    meta: Record<string, string | number | boolean | null>;
  },
): Promise<T | null> {
  if (!run.aiAllowed || !run.deps.ai) return null;
  try {
    const res = await run.deps.ai.generateObject({
      task: "catalog_extract",
      schema: req.schema,
      system: req.system,
      input: req.input,
      clientId: run.client.id,
      clientPolicy: run.client.aiPolicy,
      // external_restricted: the person explicitly confirmed sending these files (page 73).
      approvedProviders: run.options.aiConfirmed ? providerIds : [],
      authorizedBy: run.options.aiConfirmedBy ?? run.createdBy,
      jobId: run.ctx.jobId ?? null,
      inputSummary: { meta: { importId: run.importId, ...req.meta } },
    });
    run.costMicroUsd += res.costMicroUsd;
    return res.data;
  } catch (err) {
    if (err instanceof ForgecyError) {
      const code =
        err.code === "policy_blocked"
          ? "POLICY-BLOCKED"
          : err.code === "budget_exceeded"
            ? "BUDGET-EXCEEDED"
            : "PROVIDER-UNAVAILABLE";
      const message =
        code === "POLICY-BLOCKED"
          ? `${run.client.name}'s policy does not allow AI analysis of these files.`
          : code === "BUDGET-EXCEEDED"
            ? `${run.client.name}'s AI budget is used up: the rest of the import continues without AI analysis.`
            : "The AI provider is not responding. Sheet rows already read are saved; retry the analysis of PDFs and images.";
      run.warnings.push({ code, message, ...(req.fileId ? { fileId: req.fileId } : {}) });
      // After a policy or budget block, stop calling: every next call would fail the same way.
      if (code !== "PROVIDER-UNAVAILABLE") run.aiAllowed = false;
      run.deps.logger?.warn(
        { importId: run.importId, code, err: err.message },
        "catalog import AI step skipped",
      );
      return null;
    }
    throw err;
  }
}

// ---------------------------------------------------------------- scan

async function scan(run: Run): Promise<boolean> {
  const { db } = run.deps;
  const all = await files(run);
  const archives = all.filter(
    (f) => f.kind === "archive" && f.valid && f.route !== "ignore" && !f.parentId,
  );
  let done = 0;
  for (const archive of archives) {
    if (all.some((f) => f.parentId === archive.id)) continue; // already expanded (retry)
    await expandArchive(run, archive);
    await run.ctx.progress?.(5 + Math.round((++done / archives.length) * 25));
  }

  const sheets = (await files(run)).filter(
    (f) => f.kind === "sheet" && f.valid && f.route === "map",
  );
  for (const sheet of sheets) {
    const meta = sheet.meta as FileMeta;
    const proposal = sheet.mappingProposal as MappingProposalData | null;
    if (sheet.mapping || !meta.headers || proposal?.preset !== "heuristic") continue;
    const ai = await callAi(run, {
      system: MAPPING_SYSTEM,
      input: mappingInput(meta.headers, meta.sample ?? []),
      schema: mappingProposalSchema,
      fileId: sheet.id,
      meta: { step: "mapping", columns: meta.headers.length },
    });
    if (!ai) continue;
    const columns = meta.headers.map(
      (_, i) => ai.columns.find((c) => c.index === i)?.target ?? "ignore",
    );
    const confidence = meta.headers.map(
      (_, i): ConfidenceLevel => ai.columns.find((c) => c.index === i)?.confidence ?? "low",
    );
    const used = new Set<string>();
    const deduped = columns.map((c) =>
      c === "ignore" || c === "variants" || !used.has(c) ? (used.add(c), c) : "ignore",
    );
    await db
      .update(productImportFiles)
      .set({ mappingProposal: { columns: deduped, confidence, preset: "ai" } })
      .where(eq(productImportFiles.id, sheet.id));
  }

  const needsMapping = sheets.some((s) => !s.mapping);
  if (needsMapping) {
    await db
      .update(productImports)
      .set({ status: "needs_mapping", summary: await baseSummary(run) })
      .where(and(eq(productImports.id, run.importId), eq(productImports.status, "analyzing")));
  }
  return needsMapping;
}

async function expandArchive(run: Run, archive: ImportFileRow) {
  const { db, storage } = run.deps;
  if (!archive.storageKey) return;
  const tmp = await downloadToTemp(storage, archive.storageKey);
  let ignored = 0;
  try {
    await readZip(tmp.path, {
      label: archive.name,
      want: (e) => sniffByName(e.path) !== null,
      onData: async (entry, data) => {
        const name = entry.path.split("/").pop()!;
        const sniff = sniffEntry(entry.path, data);
        if (!sniff.ok || !sniff.format) {
          ignored++;
          return;
        }
        const needsInspect = sniff.kind !== "image";
        const inspection = needsInspect
          ? await inspectFile(sniff.format, name, { data })
          : { valid: true, meta: {} as FileMeta, summary: "Valid" };
        const { key, sha256 } = await storeBuffer(storage, {
          clientId: run.client.id,
          data,
          ext: sniff.ext!,
          mime: sniff.mime!,
        });
        const aiOk = run.aiAllowed && !inspection.meta.textless;
        await db.insert(productImportFiles).values({
          importId: run.importId,
          clientId: run.client.id,
          parentId: archive.id,
          name,
          path: entry.path,
          kind: sniff.kind,
          format: sniff.format,
          route: inspection.valid ? proposeRoute(sniff.kind, aiOk) : "ignore",
          storageKey: key,
          sha256,
          size: data.length,
          mime: sniff.mime!,
          valid: inspection.valid,
          errorCode: "code" in inspection ? (inspection.code ?? null) : null,
          message: inspection.valid
            ? inspection.summary
            : "message" in inspection
              ? (inspection.message ?? null)
              : null,
          meta: inspection.meta as Record<string, unknown>,
          ...(sniff.kind === "image" ? { imageState: "unassigned" as const } : {}),
          ...(inspection.valid && inspection.meta.headers
            ? {
                mappingProposal: (await (
                  await import("./imports")
                ).proposeMapping(db, run.client.id, inspection.meta.headers)) as unknown as Record<
                  string,
                  unknown
                >,
              }
            : {}),
        });
        await run.ctx.heartbeat?.();
      },
    });
  } catch (err) {
    if (isImportError(err)) {
      await db
        .update(productImportFiles)
        .set({ valid: false, route: "ignore", errorCode: err.code, message: err.message })
        .where(eq(productImportFiles.id, archive.id));
      run.warnings.push({ code: err.code, message: err.message, fileId: archive.id });
      return;
    }
    throw err;
  } finally {
    await tmp.cleanup();
  }
  if (ignored)
    await db
      .update(productImportFiles)
      .set({ meta: { ...(archive.meta as Record<string, unknown>), ignoredAfterRead: ignored } })
      .where(eq(productImportFiles.id, archive.id));
}

// ---------------------------------------------------------------- extract

async function extract(run: Run) {
  const { db, storage } = run.deps;
  // Idempotent: a retry rebuilds the items from scratch.
  await db.delete(productImportItems).where(eq(productImportItems.importId, run.importId));
  const all = (await files(run)).filter((f) => f.valid && f.route !== "ignore");
  const sheetCandidates: Candidate[] = [];
  const discarded: Array<{ reason: string; origin: SourceRef; draft: ProductDraft }> = [];

  // 1. Sheets with their confirmed mapping.
  for (const f of all.filter((x) => x.kind === "sheet" && x.mapping && x.storageKey)) {
    const mapping = columnMappingSchema.parse(f.mapping);
    const data = await readStored(storage, f.storageKey!, IMPORT_LIMITS.sheetBytes);
    const meta = f.meta as FileMeta;
    const sheet = await parseSheet(data, f.name, f.format === "xlsx" ? "xlsx" : "csv", meta.csv);
    const kind = f.format === "xlsx" ? "xlsx" : "csv";
    const { rows, rejected } = applyMapping(sheet, mapping, {
      kind,
      fileId: f.id,
      fileName: f.name,
      importId: run.importId,
    });
    for (const r of rows) {
      const confidence: Partial<Record<FieldKey, ConfidenceLevel>> = {};
      for (const k of Object.keys(r.draft) as FieldKey[]) confidence[k] = "high";
      sheetCandidates.push({
        draft: r.draft,
        sources: r.sources,
        confidence,
        images: [],
        origin: { kind, fileId: f.id, fileName: f.name, row: r.row, importId: run.importId },
        ...(r.images.length ? { imageNames: r.images } : {}),
      });
    }
    for (const r of rejected)
      discarded.push({
        reason: r.reason,
        origin: { kind, fileId: f.id, fileName: f.name, row: r.row },
        draft: {},
      });
  }
  await run.ctx.progress?.(40);

  // 2. PDFs: AI extraction when allowed, otherwise they stay as consultable sources.
  const pdfCandidates: Candidate[] = [];
  for (const f of all.filter((x) => x.kind === "pdf" && x.route === "extract" && x.storageKey)) {
    if (!run.aiAllowed) {
      run.warnings.push({
        code: "POLICY-BLOCKED",
        message: run.aiReason ?? "AI analysis not available: the PDF stays as a source.",
        fileId: f.id,
      });
      continue;
    }
    const data = await readStored(storage, f.storageKey!, IMPORT_LIMITS.pdfBytes);
    let pages: string[];
    try {
      const pdf = await readPdfText(data, f.name);
      if (pdf.textless) {
        run.warnings.push({
          code: "IMPORT-PDF-UNREADABLE",
          message: `"${f.name}" is a scan without readable text: it stays as a source for manual entry.`,
          fileId: f.id,
        });
        continue;
      }
      pages = pdf.pages;
    } catch (err) {
      if (isImportError(err)) {
        run.warnings.push({ code: err.code, message: err.message, fileId: f.id });
        continue;
      }
      throw err;
    }
    for (const chunk of chunkPages(pages)) {
      if (await run.ctx.isCancelled?.()) return { cancelled: true };
      const res = await callAi(run, {
        system: PDF_EXTRACTION_SYSTEM,
        input: pdfExtractionInput({
          fileName: f.name,
          language: run.options.language,
          chunk: chunk.text,
          from: chunk.from,
          to: chunk.to,
        }),
        schema: pdfExtractionSchema,
        fileId: f.id,
        meta: { step: "pdf", file: f.id, from: chunk.from, to: chunk.to },
      });
      await run.ctx.heartbeat?.();
      if (!res) break;
      for (const p of res.products) {
        const c = pdfCandidate(p, f, chunk.from, run);
        if (c) pdfCandidates.push(c);
      }
      for (const s of res.skippedPages)
        discarded.push({
          reason: `Page ${s.page}: ${s.reason.slice(0, 160)}`,
          origin: { kind: "pdf", fileId: f.id, fileName: f.name, page: s.page },
          draft: {},
        });
    }
  }
  await run.ctx.progress?.(65);

  // 3. Folders, texts and images: by folder name, file name and SKU.
  let candidates = mergeCandidates([...sheetCandidates, ...pdfCandidates]);
  const material: MaterialFile[] = [];
  for (const f of all.filter(
    (x) => (x.kind === "image" || x.kind === "text") && x.route === "match",
  )) {
    if (f.kind === "image") {
      if (run.options.matchImages) material.push({ id: f.id, path: f.path, kind: "image" });
      continue;
    }
    if (!f.storageKey) continue;
    try {
      const text = await readTextDocument(
        await readStored(storage, f.storageKey, IMPORT_LIMITS.sheetBytes),
        f.name,
        f.format === "docx" ? "docx" : "txt",
      );
      const parsed = parseProductText(text);
      const draft = sanitizeDraft({
        ...parsed,
        materials: parsed.materials ? parsed.materials.split(/\n|;\s*/) : undefined,
        formats: parsed.formats ? parsed.formats.split(/\n|;\s*/) : undefined,
        usage: parsed.usage ? parsed.usage.split(/\n/) : undefined,
        features: parsed.features ? parsed.features.split(/\n|;\s*/) : undefined,
        benefits: parsed.benefits ? parsed.benefits.split(/\n|;\s*/) : undefined,
        tags: parsed.tags ? parsed.tags.split(/,\s*/) : undefined,
      } as ProductDraft);
      material.push({ id: f.id, path: f.path, kind: "text", textFields: draft });
    } catch (err) {
      if (!isImportError(err)) throw err;
      run.warnings.push({ code: err.code, message: err.message, fileId: f.id });
    }
  }
  const matched = matchMaterial(material, candidates, (m) => ({
    kind: "text",
    fileId: m.id,
    fileName: m.path,
    importId: run.importId,
  }));
  candidates = mergeCandidates([...candidates, ...matched.candidates]);
  await run.ctx.progress?.(75);

  // 4. Compare with the catalog: duplicates (SKU, then name + category) and conflicts.
  const existing = await db
    .select()
    .from(products)
    .where(and(eq(products.clientId, run.client.id), ne(products.status, "archived")));
  const bySku = new Map(existing.filter((p) => p.sku).map((p) => [normalizeSku(p.sku!), p]));
  const byName = new Map(
    existing.map((p) => [`${normalizeKey(p.name)}|${normalizeKey(p.category ?? "")}`, p]),
  );

  const fileById = new Map(all.map((f) => [f.id, f]));
  const itemIds: string[] = [];
  let position = 0;
  let duplicates = 0;
  let conflicts = 0;
  let sensitiveCount = 0;
  const assignedImages = new Set<string>();
  for (const c of candidates) {
    if (!c.draft.name) {
      discarded.push({ reason: "Product without a name", origin: c.origin, draft: c.draft });
      continue;
    }
    const fieldMeta = buildFieldMeta(c, run);
    const sensitive = Object.values(fieldMeta).some((m) => m?.sensitive?.length);
    if (sensitive) sensitiveCount++;
    const required = (["name", "category", "shortDescription"] as const)
      .map((k) => fieldMeta[k]?.confidence)
      .filter((x): x is ConfidenceLevel => !!x);
    const match =
      (c.draft.sku ? bySku.get(normalizeSku(c.draft.sku)) : undefined) ??
      byName.get(`${normalizeKey(c.draft.name)}|${normalizeKey(c.draft.category ?? "")}`);
    const conflictList: Array<{ field: FieldKey; approved: unknown; incoming: unknown }> = [];
    if (match?.status === "approved") {
      const current = rowToFields(match);
      for (const k of fieldKeys) {
        const incoming = c.draft[k];
        if (isEmptyValue(incoming) || isEmptyValue(current[k]) || sameValue(current[k], incoming))
          continue;
        conflictList.push({ field: k, approved: current[k], incoming });
      }
    }
    if (match) {
      if (conflictList.length) conflicts++;
      else duplicates++;
    }
    for (const img of c.images) assignedImages.add(img.fileId);
    const [row] = await db
      .insert(productImportItems)
      .values({
        importId: run.importId,
        clientId: run.client.id,
        position: position++,
        draft: c.draft as Record<string, unknown>,
        fieldMeta: fieldMeta as Record<string, unknown>,
        confidence: lowestConfidence(required),
        sensitive,
        origin: c.origin as unknown as Record<string, unknown>,
        images: c.images.filter((i) => fileById.has(i.fileId)) as unknown as Record<
          string,
          unknown
        >[],
        proposedByAgent: c.agent === true,
        matchProductId: match?.id ?? null,
        matchReason: match
          ? c.draft.sku && match.sku && normalizeSku(match.sku) === normalizeSku(c.draft.sku)
            ? `Same SKU ${match.sku}`
            : "Same name and category"
          : null,
        matchRevision: match?.revision ?? null,
        conflicts: conflictList as unknown as Record<string, unknown>[],
      })
      .returning({ id: productImportItems.id });
    itemIds.push(row!.id);
  }
  for (const d of discarded)
    await db.insert(productImportItems).values({
      importId: run.importId,
      clientId: run.client.id,
      position: position++,
      status: "discarded",
      draft: sanitizeDraft(d.draft) as Record<string, unknown>,
      origin: d.origin as unknown as Record<string, unknown>,
      discardReason: d.reason,
      confidence: "low",
    });

  // 5. Images: assigned or "Unassigned", with Brand Analyst suggestions when allowed.
  const imageFiles = all.filter((f) => f.kind === "image");
  if (imageFiles.length) {
    const assigned = imageFiles.filter((f) => assignedImages.has(f.id)).map((f) => f.id);
    if (assigned.length)
      await db
        .update(productImportFiles)
        .set({ imageState: "assigned" })
        .where(inArray(productImportFiles.id, assigned));
  }
  const unassigned = imageFiles.filter((f) => !assignedImages.has(f.id) && f.route === "match");
  if (unassigned.length && run.options.matchImages && candidates.length) {
    const named = candidates.filter((c) => c.draft.name);
    const list = named.slice(0, 300);
    for (let i = 0; i < unassigned.length; i += 200) {
      const batch = unassigned.slice(i, i + 200);
      const res = await callAi(run, {
        system: IMAGE_MATCH_SYSTEM,
        input: imageMatchInput(
          batch,
          list.map((c) => ({
            name: c.draft.name!,
            ...(c.draft.sku ? { sku: c.draft.sku } : {}),
            ...(c.draft.category ? { category: c.draft.category } : {}),
          })),
        ),
        schema: imageSuggestionSchema,
        meta: { step: "images", images: batch.length, products: list.length },
      });
      if (!res) break;
      for (const s of res.suggestions) {
        const file = batch[s.image];
        const cand = s.product !== null ? list[s.product] : undefined;
        if (!file || !cand) continue;
        const idx = candidates.filter((c) => c.draft.name).indexOf(cand);
        const itemId = itemIds[idx];
        if (!itemId) continue;
        await db
          .update(productImportFiles)
          .set({ suggestion: { itemId, name: cand.draft.name!, confidence: s.confidence } })
          .where(eq(productImportFiles.id, file.id));
      }
    }
  }
  await run.ctx.progress?.(95);

  const summary = {
    ...(await baseSummary(run)),
    found: itemIds.length,
    newCount: itemIds.length - duplicates - conflicts,
    duplicates,
    conflicts,
    discarded: discarded.length,
    sensitive: sensitiveCount,
    imagesMatched: assignedImages.size,
    imagesUnassigned: unassigned.length,
    aiUsed: run.costMicroUsd > 0 || pdfCandidates.length > 0,
    costMicroUsd: run.costMicroUsd,
    warnings: run.warnings,
  };
  await db.transaction(async (tx) => {
    await tx
      .update(productImports)
      .set({ status: "ready_for_review", summary })
      .where(and(eq(productImports.id, run.importId), eq(productImports.status, "analyzing")));
    await recordAuditEvent(tx, {
      actor: "system",
      action: "product_import.analyzed",
      entity: "product_import",
      entityId: run.importId,
      clientId: run.client.id,
      meta: {
        found: summary.found,
        duplicates,
        conflicts,
        discarded: summary.discarded,
        warnings: run.warnings.map((w) => w.code),
      },
    });
  });
  return { found: summary.found, duplicates, conflicts };
}

async function baseSummary(run: Run) {
  const list = await files(run);
  const top = list.filter((f) => !f.parentId);
  const count = (k: ImportFileKind) => list.filter((f) => f.kind === k && f.valid).length;
  return {
    files: top.length,
    sheets: count("sheet"),
    pdfs: count("pdf"),
    images: count("image"),
    texts: count("text"),
    rows: list.reduce((n, f) => n + ((f.meta as FileMeta).rows ?? 0), 0),
    pages: list.reduce((n, f) => n + ((f.meta as FileMeta).pages ?? 0), 0),
    pdfSources: list
      .filter((f) => f.kind === "pdf" && f.valid && f.route !== "ignore")
      .map((f) => f.id),
    warnings: run.warnings,
  };
}

function pdfCandidate(
  p: ExtractedProduct,
  f: ImportFileRow,
  firstPage: number,
  run: Run,
): Candidate | null {
  const draft = sanitizeDraft({
    name: p.name,
    sku: p.sku ?? "",
    category: p.category ?? "",
    shortDescription: p.shortDescription ?? "",
    longDescription: p.longDescription ?? "",
    materials: p.materials,
    formats: p.formats,
    usage: p.usage,
    features: p.features,
    benefits: p.benefits,
    price: p.price ?? "",
    currency: p.currency ?? "",
    availability: p.availability ?? "",
  });
  if (!draft.name) return null;
  const sources: Partial<Record<FieldKey, SourceRef>> = {};
  const confidence: Partial<Record<FieldKey, ConfidenceLevel>> = {};
  const level = confidenceFor("pdf", {
    official: run.options.official,
    aiConfidence: p.confidence,
  });
  for (const k of Object.keys(draft) as FieldKey[]) {
    const page =
      p.fieldPages.find((x) => x.field === k)?.page ?? p.fieldPages[0]?.page ?? firstPage;
    sources[k] = {
      kind: "pdf",
      fileId: f.id,
      fileName: f.name,
      page,
      importId: run.importId,
      ...(run.ctx.jobId ? { jobId: run.ctx.jobId } : {}),
    };
    confidence[k] = level;
  }
  const claims: Partial<Record<FieldKey, ClaimKind[]>> = {};
  for (const c of p.claims) claims[c.field] = [...(claims[c.field] ?? []), c.kind];
  return {
    draft,
    sources,
    confidence,
    images: [],
    origin: {
      kind: "pdf",
      fileId: f.id,
      fileName: f.name,
      page: sources.name?.page ?? firstPage,
      importId: run.importId,
    },
    agent: true,
    aiClaims: claims,
  };
}

/** Observed level, exact source, confidence and claim flags for every extracted field. */
function buildFieldMeta(c: Candidate, run: Run): FieldMetaMap {
  const flags = sensitiveFields(c.draft);
  const aiClaims = c.aiClaims ?? {};
  const meta: FieldMetaMap = {};
  for (const k of fieldKeys) {
    if (isEmptyValue(c.draft[k])) continue;
    const source = c.sources[k] ?? c.origin;
    const confidence =
      c.confidence[k] ?? confidenceFor(source.kind, { official: run.options.official });
    const kinds = [...new Set([...(flags[k] ?? []), ...(aiClaims[k] ?? [])])];
    const m: FieldMeta = { truth: "observed", source, confidence };
    if (kinds.length) m.sensitive = kinds;
    meta[k] = m;
  }
  return meta;
}

export { candidateKey, BRAND_ANALYST };
