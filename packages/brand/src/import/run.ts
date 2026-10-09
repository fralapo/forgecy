/**
 * The import job: file → pages, colors, fonts → Brand Analyst → proposals.
 * Every extracted element becomes a proposal in state `proposed`, citing the
 * source and the page. Documents wait for a person; website and social imports
 * can apply themselves on behalf of the person who started them (auto-import.ts).
 */
import { ForgecyError, loadToolEnv, type Actor, type MessageRef } from "@forgecy/core";
import { englishMessage, messageRef, type MessageKey, type MessageValues } from "@forgecy/i18n";
import type { AiGateway } from "@forgecy/ai";
import {
  and,
  brandIdentityProposals,
  brandSources,
  clients,
  eq,
  recordAuditEvent,
  sql,
  type Database,
} from "@forgecy/db";
import type { StorageDriver } from "@forgecy/files";
import {
  addSourceProposals,
  keepBestSingleValues,
  mergeSiteItems,
  rationale,
  visualCandidates,
  type CandidateProposal,
} from "./candidates";
import { detectImportFile } from "./detect";
import { ExtractionError, extractFile, type ExtractedPage, type Extraction } from "./extract";
import {
  analystOutputSchema,
  analystUserPrompt,
  ANALYST_SYSTEM,
  BRAND_ANALYST_PROMPT_VERSION,
  chunkPages,
  orderPages,
  WEBSITE_ANALYST_PROMPT_VERSION,
  WEBSITE_ANALYST_SYSTEM,
  type AnalystItem,
} from "./analyst";
import { gateCandidates } from "./gate";
import { parseSiteProbe } from "./probe-schema";
import { isSocialKind, readSocialSource, type SocialNet } from "./social";
import { knownColors, knownFonts, SITE_LOCATORS } from "./site-colors";
import { updateSourceStatus } from "../service";
import {
  applyImport,
  autoImportStatus,
  AUTO_IMPORT_KINDS,
  type AutoImportResult,
} from "../auto-import";

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
/** A dozen pages can yield over a hundred items: above the gateway's default output cap. */
const ANALYST_MAX_OUTPUT_TOKENS = 24_000;
/** A big structured answer (10-16k tokens) can take longer than the gateway's 120 s default. */
const ANALYST_TIMEOUT_MS = 180_000;

/** The provider stopped at the output cap (AiProviderError kind "max_tokens"). */
const isTruncation = (err: unknown) =>
  err instanceof ForgecyError && err.details?.kind === "max_tokens";

/** The provider did not answer in time (AiProviderError kind "timeout"). */
const isTimeout = (err: unknown) => err instanceof ForgecyError && err.details?.kind === "timeout";

export interface ImportDeps {
  db: Database;
  storage: StorageDriver;
  /** Missing when no AI provider is configured: only deterministic extraction runs. */
  ai?: AiGateway | null;
  /** Tests only: how social profiles are fetched. Production never sets it. */
  socialNet?: Pick<SocialNet, "hostCheck" | "timeoutMs" | "allowHost"> & {
    fetchImpl?: typeof fetch;
  };
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
  /** The status the import ended with; with `holdStatus` the caller still has to write it. */
  status?: "extracted" | "partial";
  /** What the automatic import applied and published (website and social sources only). */
  auto?: AutoImportResult;
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
  input: {
    clientId: string;
    sourceId: string;
    language?: string;
    /** The logo the website crawl just stored as a source, proposed as the primary logo variant. */
    logo?: { sourceId: string; image: { url: string } };
    /** Lines for the source status from steps that ran before the import (e.g. images not saved). */
    notes?: MessageRef[];
    /**
     * Apply and publish this run's proposals at the end (website and social sources only). The
     * website crawl leaves it off and applies once, after the site and its profiles.
     */
    autoApply?: boolean;
    /**
     * Leave the source "extracting" and write only the status line: the caller (the website
     * crawl) sets the final status once the profiles and the automatic import ran, so the page
     * keeps showing the import in progress until it really ends.
     */
    holdStatus?: boolean;
  },
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
  // A retry replaces what the failed attempt left pending for THIS source only: one job imports
  // several sources in turn (the site, then its social profiles) under the same run id.
  await db
    .delete(brandIdentityProposals)
    .where(
      and(
        eq(brandIdentityProposals.runId, ctx.jobId),
        eq(brandIdentityProposals.status, "proposed"),
        sql`${brandIdentityProposals.evidence} @> ${JSON.stringify([{ sourceId: source.id }])}::jsonb`,
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
    let pages = source.pages ?? [];
    // A profile link added by hand has an address and nothing read yet.
    if (isSocialKind(source.kind) && source.url && !pages.length) {
      const read = await readSocialSource(
        { db, storage: deps.storage },
        { id: source.id, url: source.url, kind: source.kind },
        {
          clientId: input.clientId,
          requestedBy: ctx.requestedBy ?? null,
          allowPrivate: loadToolEnv().FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS,
          ...deps.socialNet,
        },
      );
      if (!read.pages.length)
        return {
          sourceId: source.id,
          pages: 0,
          candidates: 0,
          proposals: 0,
          skipped: 0,
          discarded: 0,
          ai: "skipped",
          detail: read.detail,
        };
      pages = read.pages;
    }
    extraction = { pages, colors: [], fonts: [], warnings: [] };
    candidates = deterministic(extraction, source.title, "text", source.id);
  }
  // What the browser read on a website: its colors and fonts are proposed directly, and are the
  // only ones the analyst may name. An unreadable value counts as absent.
  const visual = parseSiteProbe(source.visual);
  if (visual) candidates.push(...visualCandidates(visual, input.logo));
  // Documents keep their own checks (their hex values come from the text); only a site's items
  // are verified against the page and the probe, so imports of brand books behave as before.
  const website = source.kind === "website" || isSocialKind(source.kind);
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
      const ask = (chunk: ExtractedPage[]) =>
        deps.ai!.generateObject({
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
                  knownColors: visual ? knownColors(visual, MAX_KNOWN_COLORS) : [],
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
          maxOutputTokens: ANALYST_MAX_OUTPUT_TOKENS,
          timeoutMs: ANALYST_TIMEOUT_MS,
          inputSummary: {
            fields: { document: chunk.map((p) => p.text).join("\n") },
            meta: {
              promptVersion,
              sourceId: source.id,
              pages: chunk.length,
            },
          },
        });
      // The home page and the about pages go first: the brand-level fields come from there.
      const chunks = chunkPages(website ? orderPages(textPages) : textPages);
      let order = 0;
      for (const [i, chunk] of chunks.entries()) {
        let answers: Array<{ chunk: ExtractedPage[]; res: Awaited<ReturnType<typeof ask>> }>;
        try {
          answers = [{ chunk, res: await ask(chunk) }];
        } catch (first) {
          let err = first;
          // No answer in time: the same pages once more (a slow call is often a one-off).
          let retried: typeof answers | null = null;
          if (isTimeout(err))
            try {
              retried = [{ chunk, res: await ask(chunk) }];
            } catch (second) {
              err = second;
            }
          if (retried) answers = retried;
          else {
            // A long answer cut at the output cap, or a second timeout: the same pages as two
            // halves. At most four requests per chunk; every other error ends the analyst.
            if (!(isTruncation(err) || isTimeout(err)) || chunk.length < 2) throw err;
            const half = Math.ceil(chunk.length / 2);
            answers = [];
            for (const part of [chunk.slice(0, half), chunk.slice(half)])
              answers.push({ chunk: part, res: await ask(part) });
          }
        }
        for (const { chunk: pagesAsked, res } of answers) {
          const locators = new Set(pagesAsked.map((p) => p.locator));
          for (const item of res.data.items) {
            // On a site, colors and fonts rest on the probe, not on a page.
            const fromSite = website && (item.field === "color" || item.field === "typography");
            if (!fromSite && !locators.has(item.locator)) continue; // cites a page that does not exist
            const c = fromAnalyst(item);
            if (!c) continue;
            candidates.push({
              ...c,
              ...(fromSite
                ? {
                    evidence: { locator: SITE_LOCATORS.styles },
                    ...(c.kind ? { named: true } : {}),
                  }
                : {}),
              agentModel: `${res.provider}/${res.model}`,
              chunk: order,
            });
          }
          order++;
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
    // Why items were dropped, for the activity log: counts only, never the page text.
    if (discarded) {
      const reasons: Record<string, number> = {};
      for (const d of gated.discarded) reasons[d.reason] = (reasons[d.reason] ?? 0) + 1;
      await recordAuditEvent(db, {
        actor: agent,
        action: "brand.import.gate",
        entity: "brand_source",
        entityId: source.id,
        clientId: input.clientId,
        meta: { runId: ctx.jobId, sourceId: source.id, discarded, reasons },
      });
    }
  }
  // After the gate, so a verified value is never dropped for one the gate then refuses.
  candidates = keepBestSingleValues(candidates);

  const { created, skipped } = await addSourceProposals(
    db,
    agent,
    input.clientId,
    source.id,
    candidates,
    promptVersion,
    // The site's brand color and accent go to the color roles still at their starting value.
    { colorRoles: source.kind === "website" },
  );
  const auto =
    input.autoApply && AUTO_IMPORT_KINDS.has(source.kind)
      ? await applyImport(db, {
          clientId: input.clientId,
          requestedBy: ctx.requestedBy ?? null,
          runId: ctx.jobId,
        })
      : undefined;
  await ctx.progress?.(95);
  const parts = [
    extraction.pages.length
      ? msg("brand.import.status.pagesRead", { count: extraction.pages.length })
      : null,
    msg("brand.import.status.proposals", { count: created }),
    skipped ? msg("brand.import.status.skipped", { count: skipped }) : null,
    discarded ? msg("brand.import.status.discarded", { count: discarded }) : null,
    ...(input.notes ?? []),
    ...extraction.warnings,
    aiNote,
    ...(auto ? autoImportStatus(auto) : []),
  ].filter((r): r is MessageRef => r !== null);
  const summary = detail(parts);
  const status = extraction.warnings.length || ai === "failed" ? "partial" : "extracted";
  await updateSourceStatus(db, source.id, input.holdStatus ? summary : { status, ...summary });
  return {
    status,
    sourceId: source.id,
    pages: extraction.pages.length,
    candidates: candidates.length,
    proposals: created,
    skipped,
    discarded,
    ai,
    detail: summary.statusDetail,
    ...(auto ? { auto } : {}),
  };
}
