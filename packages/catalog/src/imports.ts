import { assertCan, ForgecyError, type AiPolicy, type ImportFileRoute } from "@forgecy/core";
import {
  and,
  asc,
  clients,
  desc,
  eq,
  inArray,
  productColumnMappings,
  productImportFiles,
  productImportItems,
  productImports,
  recordAuditEvent,
  type Database,
} from "@forgecy/db";
import type { StorageDriver } from "@forgecy/files";
import { z } from "zod";
import type { ActingUser, DbLike } from "./db";
import { ImportError } from "./errors";
import { heuristicProposal, inspectFile, type FileMeta, type MappingProposalData } from "./inspect";
import type { ImportPhase } from "./jobs";
import { IMPORT_LIMITS } from "./limits";
import { columnMappingSchema, headerSignature, type ColumnMapping } from "./mapping";
import { proposeRoute, routesFor, sniffFile } from "./sniff";
import { readTempFile, storeTempFile, type TempFile } from "./storage";
import { baseName, extensionOf } from "./text";

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f]/g;

export type ImportRow = typeof productImports.$inferSelect;
export type ImportFileRow = typeof productImportFiles.$inferSelect;
export type ImportItemRow = typeof productImportItems.$inferSelect;

export interface ImportOptions {
  /** Content language (default: Italian). */
  language: string;
  /** Match images to products (by name/SKU, then AI when allowed). */
  matchImages: boolean;
  /** "Questi file sono materiale ufficiale del cliente": raises confidence. */
  official: boolean;
  /** external_restricted: the person confirmed sending files to the provider. */
  aiConfirmed?: boolean;
  aiConfirmedBy?: string;
}

export const defaultImportOptions: ImportOptions = {
  language: "italiano",
  matchImages: true,
  official: false,
};

export function importOptions(row: Pick<ImportRow, "options">): ImportOptions {
  return { ...defaultImportOptions, ...(row.options as Partial<ImportOptions>) };
}

/** Enqueues an analysis step; the web app and tests pass their own queue. */
export type EnqueueImportStep = (input: {
  importId: string;
  clientId: string;
  phase: ImportPhase;
  createdBy: string | null;
}) => Promise<string>;

export interface CatalogClient {
  id: string;
  name: string;
  slug: string;
  aiPolicy: AiPolicy;
}

/** The catalog exists only for clients, not prospects (UXA-P6-05). */
export async function loadCatalogClient(db: DbLike, clientId: string): Promise<CatalogClient> {
  const [c] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!c) throw new ForgecyError("not_found", "Cliente non trovato");
  if (c.status !== "active")
    throw new ForgecyError(
      "conflict",
      "Il catalogo prodotti è disponibile dopo la conversione in cliente.",
    );
  return { id: c.id, name: c.name, slug: c.slug, aiPolicy: c.aiPolicy };
}

export async function loadImport(
  db: DbLike,
  clientId: string,
  importId: string,
): Promise<ImportRow> {
  const [row] = await db
    .select()
    .from(productImports)
    .where(and(eq(productImports.id, importId), eq(productImports.clientId, clientId)));
  if (!row) throw new ForgecyError("not_found", "Import non trovato");
  return row;
}

function assertStatus(row: ImportRow, allowed: ImportRow["status"][], message: string) {
  if (!allowed.includes(row.status))
    throw new ForgecyError("conflict", message, { code: "CONFLICT-STATE" });
}

/** An import still collecting files for this client and user, or a new one. */
export async function openDraftImport(
  db: Database,
  user: ActingUser,
  clientId: string,
): Promise<ImportRow> {
  assertCan(user.actor, "products.manage", clientId);
  await loadCatalogClient(db, clientId);
  const [existing] = await db
    .select()
    .from(productImports)
    .where(
      and(
        eq(productImports.clientId, clientId),
        eq(productImports.status, "uploading"),
        eq(productImports.createdBy, user.id),
      ),
    )
    .orderBy(desc(productImports.createdAt))
    .limit(1);
  if (existing) return existing;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(productImports)
      .values({
        clientId,
        createdBy: user.id,
        options: defaultImportOptions as unknown as Record<string, unknown>,
      })
      .returning();
    await recordAuditEvent(tx, {
      actor: user.actor,
      action: "product_import.create",
      entity: "product_import",
      entityId: row!.id,
      clientId,
    });
    return row!;
  });
}

/** Imports shown in the catalog banner: running, waiting for mapping, to review, failed. */
export async function activeImports(db: DbLike, clientId: string): Promise<ImportRow[]> {
  return db
    .select()
    .from(productImports)
    .where(
      and(
        eq(productImports.clientId, clientId),
        inArray(productImports.status, [
          "analyzing",
          "needs_mapping",
          "ready_for_review",
          "failed",
        ]),
      ),
    )
    .orderBy(desc(productImports.createdAt))
    .limit(10);
}

export async function importFiles(db: DbLike, importId: string): Promise<ImportFileRow[]> {
  return db
    .select()
    .from(productImportFiles)
    .where(eq(productImportFiles.importId, importId))
    .orderBy(asc(productImportFiles.createdAt), asc(productImportFiles.path));
}

/** Proposal for a sheet: saved mapping of the client, WooCommerce preset, synonyms. */
export async function proposeMapping(
  db: DbLike,
  clientId: string,
  headers: string[],
): Promise<MappingProposalData> {
  const signature = headerSignature(headers);
  const [saved] = await db
    .select()
    .from(productColumnMappings)
    .where(
      and(
        eq(productColumnMappings.clientId, clientId),
        eq(productColumnMappings.signature, signature),
      ),
    )
    .orderBy(desc(productColumnMappings.updatedAt))
    .limit(1);
  if (saved) {
    const parsed = columnMappingSchema.safeParse(saved.mapping);
    if (parsed.success && parsed.data.columns.length === headers.length)
      return {
        ...parsed.data,
        preset: "saved",
        savedName: saved.name,
        confidence: parsed.data.columns.map(() => "high"),
      };
  }
  return heuristicProposal(headers);
}

/**
 * Add one uploaded file (already spooled to a temp file): recognize the type,
 * validate it, store it and read what the list shows. Invalid files are kept
 * with their error so the person sees why.
 */
export async function addUploadedFile(
  db: Database,
  storage: StorageDriver,
  user: ActingUser,
  input: {
    clientId: string;
    importId: string;
    relativePath: string;
    temp: TempFile;
    aiAvailable: boolean;
  },
): Promise<ImportFileRow> {
  assertCan(user.actor, "products.manage", input.clientId);
  const imp = await loadImport(db, input.clientId, input.importId);
  assertStatus(imp, ["uploading"], "L'analisi è in corso: aggiungi i file in un nuovo import.");
  const count = (
    await db
      .select({ id: productImportFiles.id })
      .from(productImportFiles)
      .where(eq(productImportFiles.importId, imp.id))
  ).length;
  if (count >= IMPORT_LIMITS.filesPerImport)
    throw new ImportError(
      "IMPORT-TOO-LARGE",
      `Un import può contenere al massimo ${IMPORT_LIMITS.filesPerImport} file.`,
    );

  const relativePath = sanitizePath(input.relativePath);
  const name = relativePath.split("/").pop()!;
  const sniff = sniffFile(name, input.temp.size, input.temp.head);
  let values: typeof productImportFiles.$inferInsert = {
    importId: imp.id,
    clientId: input.clientId,
    name,
    path: relativePath,
    kind: sniff.kind,
    route: "ignore",
    size: input.temp.size,
    valid: false,
    errorCode: sniff.code ?? null,
    message: sniff.message ?? null,
  };
  if (sniff.ok && sniff.format) {
    const needsData = sniff.format !== "zip" && sniff.kind !== "image";
    const data = needsData ? await readTempFile(input.temp) : undefined;
    const inspection = await inspectFile(
      sniff.format,
      name,
      data ? { data } : { path: input.temp.path },
    );
    const key = await storeTempFile(storage, {
      clientId: input.clientId,
      temp: input.temp,
      ext: sniff.ext!,
      mime: sniff.mime!,
    });
    values = {
      ...values,
      format: sniff.format,
      mime: sniff.mime!,
      storageKey: key,
      sha256: input.temp.sha256,
      valid: inspection.valid,
      errorCode: inspection.code ?? null,
      message: inspection.valid ? inspection.summary : (inspection.message ?? null),
      meta: inspection.meta as Record<string, unknown>,
      route: inspection.valid
        ? proposeRoute(sniff.kind, input.aiAvailable && !inspection.meta.textless)
        : "ignore",
      ...(sniff.kind === "image" ? { imageState: "unassigned" as const } : {}),
    };
    if (inspection.valid && inspection.meta.headers)
      values.mappingProposal = (await proposeMapping(
        db,
        input.clientId,
        inspection.meta.headers,
      )) as unknown as Record<string, unknown>;
  }
  const [row] = await db.insert(productImportFiles).values(values).returning();
  return row!;
}

/** Keep folder structure for grouping, but never anything that could escape it. */
export function sanitizePath(p: string): string {
  const parts = p
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.replace(CONTROL_CHARS, "").trim())
    .filter((s) => s && s !== "." && s !== "..");
  const joined = parts.slice(-6).join("/").slice(-400);
  return joined || "file";
}

export async function removeImportFile(
  db: Database,
  user: ActingUser,
  input: { clientId: string; importId: string; fileId: string },
): Promise<void> {
  assertCan(user.actor, "products.manage", input.clientId);
  const imp = await loadImport(db, input.clientId, input.importId);
  assertStatus(imp, ["uploading"], "I file si rimuovono solo prima dell'avvio dell'analisi.");
  await db
    .delete(productImportFiles)
    .where(and(eq(productImportFiles.id, input.fileId), eq(productImportFiles.importId, imp.id)));
}

export async function setFileRoute(
  db: Database,
  user: ActingUser,
  input: {
    clientId: string;
    importId: string;
    fileId: string;
    route: ImportFileRoute;
    aiAvailable: boolean;
  },
): Promise<void> {
  assertCan(user.actor, "products.manage", input.clientId);
  const imp = await loadImport(db, input.clientId, input.importId);
  assertStatus(imp, ["uploading"], "Il percorso si cambia solo prima dell'avvio dell'analisi.");
  const [file] = await db
    .select()
    .from(productImportFiles)
    .where(and(eq(productImportFiles.id, input.fileId), eq(productImportFiles.importId, imp.id)));
  if (!file) throw new ForgecyError("not_found", "File non trovato");
  if (
    !file.valid ||
    !routesFor(file.kind, input.aiAvailable && !(file.meta as FileMeta).textless).includes(
      input.route,
    )
  )
    throw new ForgecyError("validation", "Percorso non disponibile per questo file");
  await db
    .update(productImportFiles)
    .set({ route: input.route })
    .where(eq(productImportFiles.id, file.id));
}

/** IMPORT-CSV-ENCODING: re-read a CSV with the encoding and separator chosen by the person. */
export async function rereadCsv(
  db: Database,
  storage: StorageDriver,
  user: ActingUser,
  input: {
    clientId: string;
    importId: string;
    fileId: string;
    encoding: "utf-8" | "windows-1252";
    delimiter: string;
  },
): Promise<ImportFileRow> {
  assertCan(user.actor, "products.manage", input.clientId);
  const imp = await loadImport(db, input.clientId, input.importId);
  assertStatus(imp, ["uploading", "needs_mapping"], "Il file non si può più rileggere.");
  const [file] = await db
    .select()
    .from(productImportFiles)
    .where(and(eq(productImportFiles.id, input.fileId), eq(productImportFiles.importId, imp.id)));
  if (!file?.storageKey || file.format !== "csv")
    throw new ForgecyError("not_found", "File CSV non trovato");
  const { readStored } = await import("./storage");
  const data = await readStored(storage, file.storageKey, IMPORT_LIMITS.sheetBytes);
  const delimiter =
    { comma: ",", semicolon: ";", tab: "\t", pipe: "|" }[input.delimiter] ?? input.delimiter;
  const inspection = await inspectFile(
    "csv",
    file.name,
    { data },
    { encoding: input.encoding, delimiter },
  );
  const [row] = await db
    .update(productImportFiles)
    .set({
      valid: inspection.valid,
      errorCode: inspection.code ?? null,
      message: inspection.valid ? inspection.summary : (inspection.message ?? null),
      meta: inspection.meta as Record<string, unknown>,
      route: inspection.valid ? "map" : "ignore",
      mapping: null,
      mappingProposal: inspection.meta.headers
        ? ((await proposeMapping(db, input.clientId, inspection.meta.headers)) as unknown as Record<
            string,
            unknown
          >)
        : null,
    })
    .where(eq(productImportFiles.id, file.id))
    .returning();
  return row!;
}

export const importOptionsSchema = z.object({
  language: z.string().trim().min(2).max(40),
  matchImages: z.boolean(),
  official: z.boolean(),
});

export async function setImportOptions(
  db: Database,
  user: ActingUser,
  input: { clientId: string; importId: string; options: z.infer<typeof importOptionsSchema> },
): Promise<void> {
  assertCan(user.actor, "products.manage", input.clientId);
  const imp = await loadImport(db, input.clientId, input.importId);
  assertStatus(imp, ["uploading"], "Le opzioni si cambiano solo prima dell'avvio dell'analisi.");
  const options = importOptionsSchema.parse(input.options);
  await db
    .update(productImports)
    .set({ options: { ...importOptions(imp), ...options } as unknown as Record<string, unknown> })
    .where(eq(productImports.id, imp.id));
}

/** Which AI steps an import would run: shown with cost and budget before starting. */
export function plannedAiSteps(
  files: ImportFileRow[],
  options: ImportOptions,
  aiAvailable: boolean,
) {
  if (!aiAvailable) return { pdfChars: 0, pdfPages: 0, images: 0, sheets: 0, usesAi: false };
  let pdfChars = 0;
  let pdfPages = 0;
  let images = 0;
  let sheets = 0;
  for (const f of files) {
    if (!f.valid || f.route === "ignore") continue;
    const meta = f.meta as FileMeta;
    if (f.kind === "pdf" && f.route === "extract") {
      pdfChars += meta.chars ?? 0;
      pdfPages += meta.pages ?? 0;
    }
    if (f.kind === "archive") {
      // PDFs inside a ZIP are read after expansion: estimate from their size.
      pdfChars += Math.round((meta.archive?.pdfBytes ?? 0) / 20);
      if (options.matchImages) images += meta.archive?.images ?? 0;
    }
    if (f.kind === "image" && options.matchImages) images++;
    if (
      f.kind === "sheet" &&
      f.route === "map" &&
      (f.mappingProposal as MappingProposalData | null)?.preset === "heuristic"
    )
      sheets++;
  }
  return { pdfChars, pdfPages, images, sheets, usesAi: pdfChars > 0 || images > 0 };
}

/**
 * "Avvia analisi". With external_restricted the person must confirm sending the
 * files to the provider first. The job never starts if the policy blocks it.
 */
export async function startImport(
  db: Database,
  enqueue: EnqueueImportStep,
  user: ActingUser,
  input: { clientId: string; importId: string; aiConfirmed?: boolean; aiAvailable: boolean },
): Promise<void> {
  assertCan(user.actor, "products.manage", input.clientId);
  const client = await loadCatalogClient(db, input.clientId);
  const imp = await loadImport(db, input.clientId, input.importId);
  assertStatus(imp, ["uploading"], "L'import è già stato avviato.");
  const files = await importFiles(db, imp.id);
  if (!files.some((f) => f.valid && f.route !== "ignore"))
    throw new ForgecyError(
      "validation",
      "Carica almeno un file valido prima di avviare l'analisi.",
    );
  const running = await db
    .select({ id: productImports.id })
    .from(productImports)
    .where(
      and(eq(productImports.clientId, input.clientId), eq(productImports.status, "analyzing")),
    );
  if (running.length)
    throw new ForgecyError(
      "conflict",
      "C'è già un import in analisi per questo cliente: attendi che finisca.",
    );
  const options = importOptions(imp);
  const plan = plannedAiSteps(files, options, input.aiAvailable);
  if (plan.usesAi && client.aiPolicy === "external_restricted" && !input.aiConfirmed)
    throw new ForgecyError(
      "validation",
      "Conferma l'invio dei file al provider AI esterno prima di avviare l'analisi.",
    );
  await db.transaction(async (tx) => {
    await tx
      .update(productImports)
      .set({
        status: "analyzing",
        startedAt: new Date(),
        error: null,
        errorCode: null,
        failedStep: null,
        options: {
          ...options,
          ...(input.aiConfirmed ? { aiConfirmed: true, aiConfirmedBy: user.id } : {}),
        } as unknown as Record<string, unknown>,
      })
      .where(and(eq(productImports.id, imp.id), eq(productImports.status, "uploading")));
    await recordAuditEvent(tx, {
      actor: user.actor,
      action: "product_import_started",
      entity: "product_import",
      entityId: imp.id,
      clientId: input.clientId,
      meta: { files: files.length, kinds: [...new Set(files.map((f) => f.kind))] },
    });
  });
  const jobId = await enqueue({
    importId: imp.id,
    clientId: input.clientId,
    phase: "scan",
    createdBy: user.id,
  });
  await db.update(productImports).set({ jobId }).where(eq(productImports.id, imp.id));
}

/**
 * "Conferma mappatura": a person confirms (and can save) the mapping of one sheet.
 * When every sheet is mapped the analysis resumes.
 */
export async function confirmMapping(
  db: Database,
  enqueue: EnqueueImportStep,
  user: ActingUser,
  input: {
    clientId: string;
    importId: string;
    fileId: string;
    mapping: ColumnMapping;
    saveAs?: string;
  },
): Promise<{ resumed: boolean }> {
  assertCan(user.actor, "products.manage", input.clientId);
  const imp = await loadImport(db, input.clientId, input.importId);
  assertStatus(imp, ["needs_mapping"], "Questo import non aspetta una mappatura.");
  const [file] = await db
    .select()
    .from(productImportFiles)
    .where(and(eq(productImportFiles.id, input.fileId), eq(productImportFiles.importId, imp.id)));
  const headers = (file?.meta as FileMeta | undefined)?.headers;
  if (!file || !headers) throw new ForgecyError("not_found", "Foglio non trovato");
  const mapping = columnMappingSchema.parse(input.mapping);
  if (mapping.columns.length !== headers.length)
    throw new ForgecyError("validation", "La mappatura non corrisponde alle colonne del file");
  if (!mapping.columns.includes("name"))
    throw new ForgecyError(
      "validation",
      "Mappa la colonna con il nome del prodotto: è obbligatoria.",
    );
  const resumed = await db.transaction(async (tx) => {
    await tx
      .update(productImportFiles)
      .set({
        mapping: mapping as unknown as Record<string, unknown>,
        mappingConfirmedBy: user.id,
        mappingConfirmedAt: new Date(),
      })
      .where(eq(productImportFiles.id, file.id));
    const saveAs = input.saveAs?.trim().slice(0, 80);
    if (saveAs) {
      await tx
        .insert(productColumnMappings)
        .values({
          clientId: input.clientId,
          name: saveAs,
          signature: headerSignature(headers),
          mapping: { ...mapping, preset: "saved" },
          createdBy: user.id,
        })
        .onConflictDoUpdate({
          target: [productColumnMappings.clientId, productColumnMappings.name],
          set: {
            signature: headerSignature(headers),
            mapping: { ...mapping, preset: "saved" },
            updatedAt: new Date(),
          },
        });
    }
    await recordAuditEvent(tx, {
      actor: user.actor,
      action: "product_mapping_confirmed",
      entity: "product_import",
      entityId: imp.id,
      clientId: input.clientId,
      meta: { fileId: file.id, saved: Boolean(saveAs) },
    });
    const pending = await tx
      .select({ id: productImportFiles.id, mapping: productImportFiles.mapping })
      .from(productImportFiles)
      .where(
        and(
          eq(productImportFiles.importId, imp.id),
          eq(productImportFiles.kind, "sheet"),
          eq(productImportFiles.route, "map"),
          eq(productImportFiles.valid, true),
        ),
      );
    if (pending.some((p) => p.id !== file.id && !p.mapping)) return false;
    const [moved] = await tx
      .update(productImports)
      .set({ status: "analyzing" })
      .where(and(eq(productImports.id, imp.id), eq(productImports.status, "needs_mapping")))
      .returning({ id: productImports.id });
    return Boolean(moved);
  });
  if (resumed) {
    const jobId = await enqueue({
      importId: imp.id,
      clientId: input.clientId,
      phase: "extract",
      createdBy: user.id,
    });
    await db.update(productImports).set({ jobId }).where(eq(productImports.id, imp.id));
  }
  return { resumed };
}

/** "Riprova dal passo" after IMPORT-FAILED. */
export async function retryImport(
  db: Database,
  enqueue: EnqueueImportStep,
  user: ActingUser,
  input: { clientId: string; importId: string },
): Promise<void> {
  assertCan(user.actor, "products.manage", input.clientId);
  const imp = await loadImport(db, input.clientId, input.importId);
  assertStatus(imp, ["failed"], "Solo un import non riuscito si può riprovare.");
  const phase: ImportPhase = imp.failedStep === "scan" ? "scan" : "extract";
  await db
    .update(productImports)
    .set({ status: "analyzing", error: null, errorCode: null })
    .where(eq(productImports.id, imp.id));
  const jobId = await enqueue({
    importId: imp.id,
    clientId: input.clientId,
    phase,
    createdBy: user.id,
  });
  await db.update(productImports).set({ jobId }).where(eq(productImports.id, imp.id));
}

/** "Annulla import": nothing enters the catalog; the files stay in the import's storage. */
export async function cancelImport(
  db: Database,
  user: ActingUser,
  input: { clientId: string; importId: string },
  cancelJob?: (jobId: string) => Promise<unknown>,
): Promise<void> {
  assertCan(user.actor, "products.manage", input.clientId);
  const imp = await loadImport(db, input.clientId, input.importId);
  assertStatus(
    imp,
    ["uploading", "analyzing", "needs_mapping", "failed"],
    "Questo import non si può più annullare.",
  );
  await db.transaction(async (tx) => {
    await tx
      .update(productImports)
      .set({ status: "cancelled", closedBy: user.id, closedAt: new Date() })
      .where(eq(productImports.id, imp.id));
    await tx.delete(productImportItems).where(eq(productImportItems.importId, imp.id));
    await recordAuditEvent(tx, {
      actor: user.actor,
      action: "product_import.cancel",
      entity: "product_import",
      entityId: imp.id,
      clientId: input.clientId,
    });
  });
  if (imp.jobId && cancelJob) await cancelJob(imp.jobId).catch(() => undefined);
}

export { baseName, extensionOf };
