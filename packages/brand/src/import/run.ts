/**
 * The import job: file → pages, colors, fonts → Brand Analyst → proposals.
 * Every extracted element becomes a proposal in state `proposed`, citing the
 * source and the page; nothing becomes official without a person.
 */
import { ForgecyError, type Actor, type MessageRef } from "@forgecy/core";
import { englishMessage, messageRef, type MessageKey, type MessageValues } from "@forgecy/i18n";
import type { AiGateway } from "@forgecy/ai";
import { and, brandIdentityProposals, brandSources, clients, eq, type Database } from "@forgecy/db";
import type { StorageDriver } from "@forgecy/files";
import {
  addSourceProposals,
  mergeSiteItems,
  rationale,
  visualCandidates,
  type CandidateProposal,
} from "./candidates";
import { detectImportFile } from "./detect";
import { ExtractionError, extractFile, type Extraction } from "./extract";
import {
  analystOutputSchema,
  analystUserPrompt,
  ANALYST_SYSTEM,
  BRAND_ANALYST_PROMPT_VERSION,
  chunkPages,
  WEBSITE_ANALYST_PROMPT_VERSION,
  WEBSITE_ANALYST_SYSTEM,
  type AnalystItem,
} from "./analyst";
import { gateCandidates } from "./gate";
import { parseSiteProbe } from "./probe-schema";
import { knownColors, knownFonts, SITE_LOCATORS } from "./site-colors";
import { updateSourceStatus } from "../service";

const msg = (key: MessageKey & `brand.import.${string}`, values?: MessageValues) =>
  messageRef(key, values);

/** Source status line: English text for logs and the API, references for the interface. */
function detail(refs: MessageRef[]) {
  return {
    statusDetail: refs
      .map((r) => englishMessage(r.key as MessageKey, r.values))
      .join(" · ")
      .slice(0, 500),
    statusDetailRef: refs,
  };
}

const MAX_KNOWN_COLORS = 24;

export interface ImportDeps {
  db: Database;
  storage: StorageDriver;
  /** Missing when no AI provider is configured: only deterministic extraction runs. */
  ai?: AiGateway | null;
}

export interface ImportContext {
  jobId: string;
  attempt: number;
  maxAttempts: number;
  requestedBy?: string | null;
  progress?(percent: number): Promise<void>;
}

export interface ImportResult {
  sourceId: string;
  pages: number;
  candidates: number;
  proposals: number;
  skipped: number;
  /** Items the gate refused because the site does not support them. */
  discarded: number;
  ai: "done" | "skipped" | "failed";
  detail: string;
}

async function readAll(stream: AsyncIterable<unknown>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const c of stream) {
    const u = c instanceof Uint8Array ? c : new Uint8Array(c as ArrayBuffer);
    chunks.push(u);
    size += u.byteLength;
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

function fromAnalyst(item: AnalystItem): CandidateProposal | null {
  const evidence = { locator: item.locator, quote: item.quote };
  const base = { rationale: item.rationale, modelConfidence: item.confidence, evidence };
  switch (item.field) {
    case "oneLiner":
    case "insight":
    case "positioning":
    case "promise":
    case "differentiation":
    case "mission":
    case "vision":
    case "category":
      return { ...base, path: `/document/strategy/${item.field}`, op: "set", value: item.text };
    case "voice":
      return { ...base, path: "/document/verbal/voice", op: "set", value: item.text };
    case "value":
      return {
        ...base,
        path: "/document/strategy/values",
        op: "append",
        value: { name: item.name, ...(item.description ? { description: item.description } : {}) },
      };
    case "audience":
      return {
        ...base,
        path: "/document/strategy/audience",
        op: "append",
        value: {
          name: item.name,
          ...(item.role ? { role: item.role } : {}),
          ...(item.problems ? { problems: item.problems } : {}),
          ...(item.goals ? { goals: item.goals } : {}),
        },
      };
    case "message":
      return {
        ...base,
        path: "/document/strategy/messages",
        op: "append",
        value: { kind: item.kind, text: item.text, ...(item.proof ? { proof: item.proof } : {}) },
      };
    case "avoidTopic":
      return { ...base, path: "/document/strategy/avoidTopics", op: "append", value: item.text };
    case "toneAxis":
      return {
        ...base,
        path: "/document/verbal/toneAxes",
        op: "append",
        value: {
          axis: item.axis,
          value: item.value,
          goodExample: item.goodExample,
          badExample: item.badExample,
        },
      };
    case "weAre":
      return {
        ...base,
        path: "/document/verbal/weAreWeAreNot",
        op: "append",
        value: { weAre: item.weAre, weAreNot: item.weAreNot },
      };
    case "preferredWord":
      return { ...base, path: "/document/verbal/preferredWords", op: "append", value: item.text };
    case "forbiddenWord":
      return { ...base, path: "/document/verbal/forbiddenWords", op: "append", value: item.text };
    case "color":
      return {
        ...base,
        kind: "color",
        path: "",
        op: "set",
        value: { name: item.name, hex: item.hex, usage: item.usage },
      };
    case "typography":
      return {
        ...base,
        path: "/document/visual/typography",
        op: "append",
        value: {
          role: item.role,
          family: item.family,
          weights: item.weights,
          licenseStatus: "to_verify",
        },
      };
    case "logoForbiddenUse":
      return {
        ...base,
        path: "/document/visual/logo/forbiddenUses",
        op: "append",
        value: item.text,
      };
    case "visualDo":
      return { ...base, path: "/document/visual/do", op: "append", value: item.text };
    case "visualDont":
      return { ...base, path: "/document/visual/dont", op: "append", value: item.text };
    default:
      return null;
  }
}

function deterministic(
  extraction: Extraction,
  fileName: string,
  type: string,
  sourceId: string,
): CandidateProposal[] {
  const out: CandidateProposal[] = [];
  const colors = [...extraction.colors].sort((a, b) => b.count - a.count).slice(0, 16);
  for (const c of colors)
    out.push({
      kind: "color",
      path: "",
      op: "set",
      value: { name: c.context, hex: c.hex, usage: "" },
      ...rationale("brand.import.rationale.color", { count: c.count }),
      evidence: { locator: c.locator, quote: c.context },
    });
  for (const f of extraction.fonts)
    out.push({
      path: "/document/visual/typography",
      op: "append",
      value: {
        role: f.role ?? "body",
        family: f.family,
        weights: f.weights,
        licenseStatus: "to_verify",
        ...(type === "font" ? { sourceId } : {}),
      },
      ...rationale(
        type === "font"
          ? "brand.import.rationale.fontImported"
          : "brand.import.rationale.fontTheme",
      ),
      evidence: { locator: f.locator },
    });
  // File names may be Italian ("marchio", "logotipo").
  if ((type === "image" || type === "svg") && /logo|marchio|logotipo/i.test(fileName)) {
    const role = /mono|nero|black|bianco|white/i.test(fileName)
      ? "logo_mono"
      : /neg|inverse|dark/i.test(fileName)
        ? "logo_negative"
        : /symbol|simbolo|icon|favicon/i.test(fileName)
          ? "symbol"
          : "logo_primary";
    out.push({
      path: "/document/visual/logo/variants",
      op: "append",
      value: { role, sourceId, background: role === "logo_negative" ? "dark" : "any" },
      ...rationale("brand.import.rationale.logo"),
      evidence: { locator: fileName },
    });
  }
  return out;
}

/** Runs the whole import for one source. Safe to retry: pending proposals of a previous attempt are replaced. */
export async function runSourceImport(
  deps: ImportDeps,
  ctx: ImportContext,
  input: { clientId: string; sourceId: string; language?: string },
): Promise<ImportResult> {
  const { db } = deps;
  const [source] = await db
    .select()
    .from(brandSources)
    .where(and(eq(brandSources.id, input.sourceId), eq(brandSources.clientId, input.clientId)));
  if (!source || source.removedAt)
    throw new ForgecyError("not_found", "Source not found or removed");
  const [client] = await db
    .select({ name: clients.name, aiPolicy: clients.aiPolicy })
    .from(clients)
    .where(eq(clients.id, input.clientId));
  if (!client) throw new ForgecyError("not_found", "Client not found");

  const agent: Actor = { type: "agent", role: "brand_analyst", runId: ctx.jobId };
  // A retry of the same run replaces what the failed attempt left pending.
  await db
    .delete(brandIdentityProposals)
    .where(
      and(
        eq(brandIdentityProposals.runId, ctx.jobId),
        eq(brandIdentityProposals.status, "proposed"),
      ),
    );
  await updateSourceStatus(db, source.id, {
    status: "extracting",
    ...detail([msg("brand.import.status.reading")]),
  });

  let extraction: Extraction;
  let candidates: CandidateProposal[];
  if (source.storageKey) {
    const bytes = await readAll(await deps.storage.get(source.storageKey));
    const detected = await detectImportFile({ name: source.title, mime: source.mime ?? "", bytes });
    if (!detected.ok) {
      await updateSourceStatus(db, source.id, {
        status: "failed",
        ...(detected.ref
          ? detail([detected.ref])
          : { statusDetail: detected.message, statusDetailRef: null }),
      });
      return {
        sourceId: source.id,
        pages: 0,
        candidates: 0,
        proposals: 0,
        skipped: 0,
        discarded: 0,
        ai: "skipped",
        detail: detected.message,
      };
    }
    try {
      extraction = await extractFile(detected.type, bytes, source.title);
    } catch (err) {
      if (!(err instanceof ExtractionError)) throw err;
      await updateSourceStatus(db, source.id, { status: "failed", ...detail([err.ref]) });
      return {
        sourceId: source.id,
        pages: 0,
        candidates: 0,
        proposals: 0,
        skipped: 0,
        discarded: 0,
        ai: "skipped",
        detail: err.message,
      };
    }
    await updateSourceStatus(db, source.id, { pages: extraction.pages });
    candidates = deterministic(extraction, source.title, detected.type, source.id);
  } else {
    extraction = { pages: source.pages ?? [], colors: [], fonts: [], warnings: [] };
    candidates = deterministic(extraction, source.title, "text", source.id);
  }
  // What the browser read on a website: its colors and fonts are proposed directly, and are the
  // only ones the analyst may name. An unreadable value counts as absent.
  const visual = parseSiteProbe(source.visual);
  if (visual) candidates.push(...visualCandidates(visual, source.id));
  // Documents keep their own checks (their hex values come from the text); only a site's items
  // are verified against the page and the probe, so imports of brand books behave as before.
  const website = source.kind === "website";
  const promptVersion = website ? WEBSITE_ANALYST_PROMPT_VERSION : BRAND_ANALYST_PROMPT_VERSION;
  await ctx.progress?.(30);

  // ---- Brand Analyst ----
  let ai: ImportResult["ai"] = "skipped";
  let aiNote: MessageRef | null = null;
  const textPages = extraction.pages.filter((p) => p.text.trim().length > 20);
  if (!deps.ai) aiNote = msg("brand.import.status.noProvider");
  else if (client.aiPolicy === "no_ai") aiNote = msg("brand.import.status.aiOff");
  else if (!textPages.length) aiNote = msg("brand.import.status.noText");
  else {
    try {
      const chunks = chunkPages(textPages);
      for (const [i, chunk] of chunks.entries()) {
        const res = await deps.ai.generateObject({
          task: "brand_propose",
          schema: analystOutputSchema,
          schemaName: "brand_identity_items",
          system: website ? WEBSITE_ANALYST_SYSTEM : ANALYST_SYSTEM,
          input: analystUserPrompt({
            clientName: client.name,
            sourceTitle: source.title,
            language: input.language ?? "en",
            pages: chunk,
            ...(website
              ? {
                  knownColors: visual ? knownColors(visual).slice(0, MAX_KNOWN_COLORS) : [],
                  knownFonts: visual ? knownFonts(visual) : [],
                  ...(visual?.organization ? { organization: visual.organization } : {}),
                }
              : {}),
          }),
          clientId: input.clientId,
          clientPolicy: client.aiPolicy,
          sends: ["documents"],
          authorizedBy: ctx.requestedBy ?? null,
          jobId: ctx.jobId,
          inputSummary: {
            fields: { document: chunk.map((p) => p.text).join("\n") },
            meta: {
              promptVersion,
              sourceId: source.id,
              pages: chunk.length,
            },
          },
        });
        const locators = new Set(chunk.map((p) => p.locator));
        for (const item of res.data.items) {
          // On a site, colors and fonts rest on the probe, not on a page.
          const fromSite = website && (item.field === "color" || item.field === "typography");
          if (!fromSite && !locators.has(item.locator)) continue; // cites a page that does not exist
          const c = fromAnalyst(item);
          if (!c) continue;
          candidates.push({
            ...c,
            ...(fromSite
              ? { evidence: { locator: SITE_LOCATORS.styles }, ...(c.kind ? { named: true } : {}) }
              : {}),
            agentModel: `${res.provider}/${res.model}`,
          });
        }
        await ctx.progress?.(30 + Math.round(((i + 1) / chunks.length) * 50));
      }
      ai = "done";
    } catch (err) {
      const last = ctx.attempt >= ctx.maxAttempts;
      if (err instanceof ForgecyError || last) {
        ai = "failed";
        aiNote =
          err instanceof ForgecyError
            ? (err.ref ?? msg("brand.import.status.aiNotRun", { message: err.message }))
            : msg("brand.import.status.aiFailed");
      } else throw err;
    }
  }

  let discarded = 0;
  if (website) {
    const gated = gateCandidates({
      candidates,
      pages: extraction.pages,
      ...(visual ? { visual } : {}),
    });
    candidates = mergeSiteItems(gated.keep);
    discarded = gated.discarded.length;
  }

  const { created, skipped } = await addSourceProposals(
    db,
    agent,
    input.clientId,
    source.id,
    candidates,
    promptVersion,
  );
  await ctx.progress?.(95);
  const parts = [
    extraction.pages.length
      ? msg("brand.import.status.pagesRead", { count: extraction.pages.length })
      : null,
    msg("brand.import.status.proposals", { count: created }),
    skipped ? msg("brand.import.status.skipped", { count: skipped }) : null,
    discarded ? msg("brand.import.status.discarded", { count: discarded }) : null,
    ...extraction.warnings,
    aiNote,
  ].filter((r): r is MessageRef => r !== null);
  const summary = detail(parts);
  const status = extraction.warnings.length || ai === "failed" ? "partial" : "extracted";
  await updateSourceStatus(db, source.id, { status, ...summary });
  return {
    sourceId: source.id,
    pages: extraction.pages.length,
    candidates: candidates.length,
    proposals: created,
    skipped,
    discarded,
    ai,
    detail: summary.statusDetail,
  };
}
