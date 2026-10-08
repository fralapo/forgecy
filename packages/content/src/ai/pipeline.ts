/**
 * The generation pipeline: Planner, Creative Director, Copywriter and Art Director steps run by the
 * worker. Each step reads only approved inputs (published Brand Identity, accepted
 * strategy, approved products), calls the AI gateway (policy, budget, logging) and
 * stores its output as something a person reviews: proposals, a new outline, draft
 * slides, a slide edit that can be undone, draft images. Agents never approve.
 */
import {
  AiProviderError,
  loadClientMemorySettings,
  type AiGateway,
  type GenerateObjectRequest,
  type ModelRef,
  type TaskRoute,
} from "@forgecy/ai";
import {
  getPublishedBrandIdentity,
  loadBrandContext,
  type BrandContext,
  type PublishedBrandIdentity,
} from "@forgecy/brand";
import {
  buildSlideSchema,
  findLayout,
  FORMATS,
  type FormatId,
  type LayoutDef,
  type SlotValue,
  type TemplateManifest,
} from "@forgecy/carousel";
import { ForgecyError, isLocale, type Actor, type AgentRole, type ProviderId } from "@forgecy/core";
import {
  and,
  contentPillars,
  contentRubrics,
  contentSlideEdits,
  contents,
  eq,
  sql,
  type Database,
} from "@forgecy/db";
import type { StorageDriver } from "@forgecy/files";
import {
  englishMessage,
  getTranslator,
  messageRef,
  type MessageKey,
  type MessageValues,
} from "@forgecy/i18n";
import { NeedsAttentionError, withLock } from "@forgecy/jobs";
import type { z } from "zod";
import { humanOnly, invalid, notFound, requireClient } from "../access";
import { commercialUseFor, storeAsset } from "../assets";
import {
  briefReady,
  createVersion,
  getContentRow,
  isLocked,
  outlineOf,
  recordOutline,
} from "../carousels/carousels";
import {
  briefSchema,
  channelFormat,
  newSlideId,
  normalizeHashtag,
  parseDocument,
  type CarouselDocument,
  type ContentChannel,
  type ContentSlide,
  type Outline,
  type Provenance,
} from "../document";
import { productSource, type ProductSummary } from "../products";
import {
  CONTENT_PROMPT_VERSION,
  CREATIVE_DIRECTION_SYSTEM,
  EDIT_SLIDE_SYSTEM,
  IMAGE_PROMPT_SYSTEM,
  OUTLINE_SYSTEM,
  PLAN_SYSTEM,
  PLANNER_SYSTEM,
  SLIDES_SYSTEM,
  creativeDirectionOutputSchema,
  creativeDirectionUserPrompt,
  editSlideOutputSchema,
  editSlideUserPrompt,
  imagePromptOutputSchema,
  imagePromptUserPrompt,
  outlineOutputSchema,
  outlineUserPrompt,
  planOutputSchema,
  planUserPrompt,
  slidesOutputSchema,
  slidesUserPrompt,
  strategyOutputSchema,
  strategyUserPrompt,
  type CarouselPromptInput,
  type SlidesOutput,
} from "./prompts";
import { saveProposedPlan, saveStrategyProposals, type ProposedRubric } from "../strategy";
import { clampSlideCount, getTemplate, pickLayout } from "../carousels/templates";
import { acceptedDirection, directionBlock, recordDirection } from "../carousels/direction";
import { frequencyLabel } from "../labels";

export interface PipelineDeps {
  db: Database;
  storage: StorageDriver;
  /** Null when no text provider is configured. */
  ai: AiGateway | null;
  /** Image providers in routing order (primary, fallback), for the commercial-use check. */
  imageRoute?: ModelRef[];
  /** When set, replaces `imageRoute` per job (MCP providers count only while connected). */
  resolveImageRoute?: (db: Database) => Promise<ModelRef[]>;
}

export interface PipelineContext {
  jobId: string;
  requestedBy: string | null;
  progress(percent: number): Promise<void>;
}

const agent = (role: AgentRole, ctx: PipelineContext): Actor => ({
  type: "agent",
  role,
  runId: ctx.jobId,
});

type JobErrorKey = Extract<MessageKey, `content.jobErrors.${string}`>;

/** A job error a person must fix, in English for the log and as a reference for the interface. */
function attention(key: JobErrorKey, values?: MessageValues, details?: Record<string, unknown>) {
  return new NeedsAttentionError(englishMessage(key, values), details, messageRef(key, values));
}

/** Turn gateway failures a person must fix into needs_attention; transient ones are retried. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AiProviderError && !err.retryable) throw aiError(err);
    if (err instanceof ForgecyError && err.code === "policy_blocked")
      throw attention("content.jobErrors.policyBlocked", undefined, err.details);
    if (err instanceof ForgecyError && ["validation", "conflict", "not_found"].includes(err.code))
      throw new NeedsAttentionError(err.message, err.details, err.ref);
    throw err;
  }
}

function aiError(err: AiProviderError): NeedsAttentionError {
  const details = { kind: err.kind };
  switch (err.kind) {
    case "auth":
      return attention("content.jobErrors.aiAuth", undefined, details);
    case "refusal":
    case "content_filter":
      return attention("content.jobErrors.aiRefusal", undefined, details);
    case "invalid_output":
      return attention("content.jobErrors.aiInvalidOutput", undefined, details);
    case "max_tokens":
      return attention("content.jobErrors.aiTruncated", undefined, details);
    default:
      return attention(
        "content.jobErrors.aiProvider",
        { message: err.message.slice(0, 200) },
        details,
      );
  }
}

function requireAi(deps: PipelineDeps): AiGateway {
  if (!deps.ai) throw attention("content.jobErrors.noAiProvider");
  return deps.ai;
}

async function brandContextFor(
  db: Database,
  actor: Actor,
  clientId: string,
  options: { channel?: string; formatKey?: string; brief?: string } = {},
): Promise<BrandContext> {
  const ctx = await loadBrandContext(db, actor, clientId, options);
  if (!ctx) throw attention("content.jobErrors.brandNotPublished");
  return ctx;
}

/** Texts the code writes into a carousel, in its language (English when not translated). */
function deliverableText(language: string) {
  return getTranslator(isLocale(language) ? language : "en", "deliverable");
}

/** Agent system prompt + the cacheable brand block; the variable part goes with the input. */
function withBrand(system: string, brand: BrandContext) {
  return {
    system: `${system}\n\n# Brand Identity (version ${brand.versionNumber})\n${brand.stable}`,
    prefix: brand.variable ? `${brand.variable}\n\n` : "",
  };
}

type CommonAi = Pick<
  GenerateObjectRequest<unknown>,
  "clientId" | "clientPolicy" | "authorizedBy" | "jobId" | "contentId" | "sends"
>;

/** Every content prompt carries texts of the client's Brand Identity (page 61). */
const SENDS_BRAND_TEXTS = ["brand_texts"] as const;

// ---- Planner ----

/** A provenance source: English label plus a reference shown in the reader's language. */
function source(
  kind: Provenance["sources"][number]["kind"],
  key: MessageKey,
  values?: MessageValues,
) {
  return { kind, label: englishMessage(key, values), ref: messageRef(key, values) };
}

export async function runProposeStrategy(
  deps: PipelineDeps,
  ctx: PipelineContext,
  input: { clientId: string; instruction: string; language?: string },
) {
  const ai = requireAi(deps);
  const actor = agent("strategist", ctx);
  const client = await requireClient(deps.db, input.clientId);
  const brandCtx = await brandContextFor(deps.db, actor, input.clientId);
  const identity = await publishedIdentity(deps.db, actor, input.clientId);
  const audience = identity.document.strategy.audience
    .filter((a) => !a.deprecated)
    .map((a) => ({ id: a.id, name: a.value.name }));
  const [pillars, rubrics, products] = await Promise.all([
    deps.db
      .select({ id: contentPillars.id, name: contentPillars.name, goal: contentPillars.goal })
      .from(contentPillars)
      .where(
        and(eq(contentPillars.clientId, input.clientId), eq(contentPillars.status, "accepted")),
      ),
    deps.db
      .select({
        id: contentRubrics.id,
        pillarId: contentRubrics.pillarId,
        name: contentRubrics.name,
      })
      .from(contentRubrics)
      .where(
        and(eq(contentRubrics.clientId, input.clientId), eq(contentRubrics.status, "accepted")),
      ),
    productSource().listApproved(deps.db, input.clientId),
  ]);
  await ctx.progress(10);
  const { system, prefix } = withBrand(PLANNER_SYSTEM, brandCtx);
  const res = await guarded(() =>
    ai.generateObject({
      task: "content_strategy",
      schema: strategyOutputSchema,
      schemaName: "content_strategy",
      system,
      input:
        prefix +
        strategyUserPrompt({
          clientName: client.name,
          audience,
          existingPillars: pillars,
          existingRubrics: rubrics,
          products: products.slice(0, 40),
          instruction: input.instruction,
          language: input.language ?? "en",
        }),
      clientId: input.clientId,
      clientPolicy: client.aiPolicy,
      sends: SENDS_BRAND_TEXTS,
      authorizedBy: ctx.requestedBy,
      jobId: ctx.jobId,
      inputSummary: {
        fields: { instruction: input.instruction },
        meta: { promptVersion: CONTENT_PROMPT_VERSION, brandVersion: brandCtx.versionNumber },
      },
    }),
  );
  await ctx.progress(80);

  const audienceIds = new Set(audience.map((a) => a.id));
  const pillarIds = new Set(pillars.map((p) => p.id));
  const out = res.data;
  const provenance: Provenance = {
    agent: "planner",
    jobId: ctx.jobId,
    provider: res.provider,
    model: res.model,
    rationale: out.rationale,
    sources: [
      source("brand", "content.labels.source.brand", { version: brandCtx.versionNumber }),
      ...(pillars.length ? [source("strategy", "content.labels.source.strategy")] : []),
      ...(products.length ? [source("catalog", "content.labels.source.catalog")] : []),
    ],
    confidence: pillars.length || audience.length ? "medium" : "low",
    ...(input.instruction ? { instruction: input.instruction } : {}),
  };
  const saved = await saveStrategyProposals(deps.db, actor, {
    clientId: input.clientId,
    brandVersionId: brandCtx.versionId,
    provenance,
    pillars: out.pillars.map((p) => ({
      targetId: pillarIds.has(p.updates) ? p.updates : null,
      values: {
        name: p.name,
        goal: p.goal,
        audienceIds: p.audienceIds.filter((a) => audienceIds.has(a)),
        funnel: p.funnel,
        themes: p.themes.filter(Boolean),
        frequency: p.frequency,
        cta: p.cta,
        emotion: p.emotion,
        examples: p.examples.filter((e) => e.title.trim()),
        forbidden: p.forbidden.filter(Boolean),
        productIds: p.productIds.filter(isUuid),
      },
    })),
    rubrics: out.rubrics.flatMap((r): ProposedRubric[] => {
      const values = {
        name: r.name,
        frequency: r.frequency,
        structure: r.structure.filter((s) => s.name.trim()),
        hookFormula: r.hookFormula,
        hookExample: r.hookExample,
        cta: r.cta,
        channels: r.channels,
      };
      if (r.pillarIndex >= 0 && r.pillarIndex < out.pillars.length)
        return [{ pillarIndex: r.pillarIndex, values }];
      if (pillarIds.has(r.pillarId)) return [{ values: { ...values, pillarId: r.pillarId } }];
      return [];
    }),
  });
  await ctx.progress(100);
  return {
    pillars: saved.pillarIds.length,
    rubrics: saved.rubricIds.length,
    costMicroUsd: res.costMicroUsd,
  };
}

const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

async function publishedIdentity(db: Database, actor: Actor, clientId: string) {
  const identity = await getPublishedBrandIdentity(db, actor, clientId);
  if (!identity) throw attention("content.jobErrors.brandNotPublished");
  return identity;
}

export async function runProposePlan(
  deps: PipelineDeps,
  ctx: PipelineContext,
  input: {
    clientId: string;
    instruction: string;
    language?: string;
    channels: ContentChannel[];
  },
) {
  const ai = requireAi(deps);
  const actor = agent("strategist", ctx);
  const client = await requireClient(deps.db, input.clientId);
  const brandCtx = await brandContextFor(deps.db, actor, input.clientId);
  const [pillars, rubrics, products] = await Promise.all([
    deps.db
      .select()
      .from(contentPillars)
      .where(
        and(eq(contentPillars.clientId, input.clientId), eq(contentPillars.status, "accepted")),
      ),
    deps.db
      .select()
      .from(contentRubrics)
      .where(
        and(eq(contentRubrics.clientId, input.clientId), eq(contentRubrics.status, "accepted")),
      ),
    productSource().listApproved(deps.db, input.clientId),
  ]);
  if (!pillars.length) throw attention("content.jobErrors.acceptPillarFirst");
  await ctx.progress(10);
  const { system, prefix } = withBrand(PLAN_SYSTEM, brandCtx);
  const freq = (c: number | null, u: "week" | "month" | null) =>
    frequencyLabel(c && u ? { count: c, unit: u } : null);
  const res = await guarded(() =>
    ai.generateObject({
      task: "content_strategy",
      schema: planOutputSchema,
      schemaName: "content_plan",
      system,
      input:
        prefix +
        planUserPrompt({
          clientName: client.name,
          language: input.language ?? "en",
          channels: input.channels,
          pillars: pillars.map((p) => ({
            id: p.id,
            name: p.name,
            goal: p.goal,
            frequency: freq(p.frequencyCount, p.frequencyUnit),
          })),
          rubrics: rubrics.map((r) => ({
            id: r.id,
            pillarId: r.pillarId,
            name: r.name,
            frequency: freq(r.frequencyCount, r.frequencyUnit),
            hookFormula: r.hookFormula ?? "",
          })),
          products: products.slice(0, 40),
          instruction: input.instruction,
        }),
      clientId: input.clientId,
      clientPolicy: client.aiPolicy,
      sends: SENDS_BRAND_TEXTS,
      authorizedBy: ctx.requestedBy,
      jobId: ctx.jobId,
      inputSummary: {
        fields: { instruction: input.instruction },
        meta: { promptVersion: CONTENT_PROMPT_VERSION, pillars: pillars.length },
      },
    }),
  );
  await ctx.progress(80);
  const pillarIds = new Set(pillars.map((p) => p.id));
  const rubricPillar = new Map(rubrics.map((r) => [r.id, r.pillarId]));
  const plan = await guarded(() =>
    saveProposedPlan(deps.db, actor, {
      clientId: input.clientId,
      brandVersionId: brandCtx.versionId,
      provenance: {
        agent: "planner",
        jobId: ctx.jobId,
        provider: res.provider,
        model: res.model,
        rationale: res.data.rationale,
        sources: [
          source("brand", "content.labels.source.brand", { version: brandCtx.versionNumber }),
          source("strategy", "content.labels.source.strategyCounts", {
            pillars: pillars.length,
            rubrics: rubrics.length,
          }),
        ],
        confidence: rubrics.length ? "high" : "medium",
        ...(input.instruction ? { instruction: input.instruction } : {}),
      },
      items: res.data.items
        .filter((i) => pillarIds.has(i.pillarId) && input.channels.includes(i.channel))
        .map((i) => ({
          day: i.day,
          channel: i.channel,
          format: channelFormat[i.channel],
          pillarId: i.pillarId,
          rubricId: rubricPillar.get(i.rubricId) === i.pillarId ? i.rubricId : null,
          theme: i.theme,
          hook: i.hook,
          notes: i.notes,
          productIds: i.productIds.filter(isUuid),
        })),
    }),
  );
  await ctx.progress(100);
  return { planId: plan.id, number: plan.number, costMicroUsd: res.costMicroUsd };
}

// ---- Copywriter ----

async function carouselPromptInput(
  db: Database,
  actor: Actor,
  c: typeof contents.$inferSelect,
  manifest: TemplateManifest,
  identity: PublishedBrandIdentity,
): Promise<CarouselPromptInput> {
  const brief = briefSchema.parse(c.brief ?? {});
  const [pillar] = c.pillarId
    ? await db.select().from(contentPillars).where(eq(contentPillars.id, c.pillarId))
    : [];
  const [rubric] = c.rubricId
    ? await db.select().from(contentRubrics).where(eq(contentRubrics.id, c.rubricId))
    : [];
  const product: ProductSummary | null = c.productId
    ? await productSource().get(db, c.clientId, c.productId)
    : null;
  const audience = identity.document.strategy.audience
    .filter((a) => c.audienceIds.includes(a.id))
    .map((a) => [a.value.name, a.value.problems, a.value.goals].filter(Boolean).join(" — "));
  void actor;
  return {
    title: c.title,
    objective: c.objective,
    channel: c.channel,
    language: c.language,
    slideCount: clampSlideCount(manifest, c.slideCount),
    audience,
    pillar: pillar
      ? {
          name: pillar.name,
          goal: pillar.goal,
          funnel: pillar.funnel,
          cta: pillar.cta,
          forbidden: pillar.forbidden,
        }
      : null,
    rubric: rubric
      ? {
          name: rubric.name,
          structure: rubric.structure as { name: string; role: string }[],
          hookFormula: rubric.hookFormula,
          hookExample: rubric.hookExample,
          cta: rubric.cta,
        }
      : null,
    product,
    brief,
    manifest,
    defaultCta: (await loadClientMemorySettings(db, c.clientId)).default_cta?.value.text ?? null,
    direction: await acceptedDirection(db, c.id),
  };
}

async function carouselSetup(
  deps: PipelineDeps,
  ctx: PipelineContext,
  clientId: string,
  contentId: string,
  role: AgentRole = "copywriter",
) {
  const actor = agent(role, ctx);
  const client = await requireClient(deps.db, clientId);
  const c = await getContentRow(deps.db, clientId, contentId);
  if (c.status === "in_review" || c.status === "archived")
    throw attention("content.jobErrors.notEditable");
  const template = await getTemplate(deps.db, clientId, c.templateKey, c.templateVersion);
  const identity = await publishedIdentity(deps.db, actor, clientId);
  const brandCtx = await brandContextFor(deps.db, actor, clientId, {
    channel: c.channel,
    formatKey: c.format,
  });
  const promptInput = await carouselPromptInput(deps.db, actor, c, template.manifest, identity);
  const common: CommonAi = {
    clientId,
    clientPolicy: client.aiPolicy,
    sends: SENDS_BRAND_TEXTS,
    authorizedBy: ctx.requestedBy,
    jobId: ctx.jobId,
    contentId,
  };
  return { actor, client, c, template, identity, brandCtx, promptInput, common };
}

const lockOf = (contentId: string, ctx: PipelineContext) => ({
  table: "contents",
  id: contentId,
  jobId: ctx.jobId,
});

async function locked<T>(
  deps: PipelineDeps,
  ctx: PipelineContext,
  contentId: string,
  fn: () => Promise<T>,
) {
  try {
    return await withLock(deps.db, lockOf(contentId, ctx), fn);
  } catch (err) {
    if (err instanceof Error && err.name === "LockUnavailableError")
      throw attention("content.jobErrors.anotherGeneration");
    throw err;
  }
}

export async function runGenerateOutline(
  deps: PipelineDeps,
  ctx: PipelineContext,
  input: { clientId: string; contentId: string; instruction: string; keepEdited: boolean },
) {
  const ai = requireAi(deps);
  return locked(deps, ctx, input.contentId, async () => {
    const s = await carouselSetup(deps, ctx, input.clientId, input.contentId);
    if (!briefReady(s.c.brief)) throw attention("content.jobErrors.briefTooShort");
    const m = s.template.manifest;
    const n = s.promptInput.slideCount;
    const previous = outlineOf(s.c);
    const keep = input.keepEdited && previous ? previous.rows.filter((r) => r.edited) : [];
    await ctx.progress(10);
    const { system, prefix } = withBrand(OUTLINE_SYSTEM, s.brandCtx);
    const res = await guarded(() =>
      ai.generateObject({
        task: "outline",
        schema: outlineOutputSchema,
        schemaName: "carousel_outline",
        system,
        input:
          prefix +
          outlineUserPrompt(s.promptInput, previous, keep) +
          (input.instruction ? `\n\n## The person's directions\n${input.instruction}` : ""),
        ...s.common,
        inputSummary: {
          fields: { brief: JSON.stringify(s.c.brief), instruction: input.instruction },
          meta: { promptVersion: CONTENT_PROMPT_VERSION, template: m.id, slides: n },
        },
      }),
    );
    await ctx.progress(80);
    const rows = res.data.rows.slice(0, n).map((r, i, all) => {
      const kept = previous?.rows[i]?.edited && input.keepEdited ? previous.rows[i] : undefined;
      if (kept) return kept;
      const layout = pickLayout(m, r.role, i, all.length, r.layout);
      return {
        id: newSlideId(),
        role: layout.role === r.role ? r.role : layout.role,
        point: r.point.trim(),
        layout: layout.id,
        note: r.note.trim(),
        edited: false,
      };
    });
    const outline: Outline = {
      title: res.data.title.trim(),
      hook: res.data.hook.trim(),
      rows,
      cta: res.data.cta.trim(),
      caption: previous?.caption ?? "",
      hashtags: previous?.hashtags ?? [],
    };
    const fresh = await getContentRow(deps.db, input.clientId, input.contentId);
    const row = await recordOutline(deps.db, {
      content: fresh,
      outline,
      origin: "ai",
      actor: s.actor,
      instruction: input.instruction || null,
      jobId: ctx.jobId,
    });
    await ctx.progress(100);
    return { outlineNumber: row.outlineNumber, rows: rows.length, costMicroUsd: res.costMicroUsd };
  });
}

// ---- Creative Director ----

/** A creative direction for one carousel, stored as a proposal a person accepts or rejects. */
export async function runCreativeDirection(
  deps: PipelineDeps,
  ctx: PipelineContext,
  input: { clientId: string; contentId: string; instruction: string },
) {
  const ai = requireAi(deps);
  const s = await carouselSetup(deps, ctx, input.clientId, input.contentId, "creative_director");
  if (!briefReady(s.c.brief)) throw attention("content.jobErrors.briefTooShort");
  const n = s.promptInput.slideCount;
  await ctx.progress(10);
  const { system, prefix } = withBrand(CREATIVE_DIRECTION_SYSTEM, s.brandCtx);
  const res = await guarded(() =>
    ai.generateObject({
      task: "creative_direction",
      schema: creativeDirectionOutputSchema,
      schemaName: "creative_direction",
      system,
      input:
        prefix +
        creativeDirectionUserPrompt(
          s.promptInput,
          s.promptInput.direction ?? null,
          input.instruction,
        ),
      ...s.common,
      inputSummary: {
        fields: { brief: JSON.stringify(s.c.brief), instruction: input.instruction },
        meta: {
          promptVersion: CONTENT_PROMPT_VERSION,
          template: s.template.manifest.id,
          slides: n,
        },
      },
    }),
  );
  await ctx.progress(80);
  const out = res.data;
  const seen = new Set<number>();
  const slides = out.slides
    .filter((x) => x.position >= 1 && x.position <= n && x.intent.trim())
    .filter((x) => !seen.has(x.position) && Boolean(seen.add(x.position)))
    .sort((a, b) => a.position - b.position)
    .map((x) => ({ position: x.position, intent: x.intent.trim(), visual: x.visual.trim() }));
  const row = await guarded(() =>
    recordDirection(deps.db, s.actor, {
      clientId: input.clientId,
      contentId: input.contentId,
      direction: {
        concept: out.concept.trim(),
        thread: out.thread.trim(),
        tone: out.tone.trim(),
        slides,
      },
      provenance: {
        agent: "creative_director",
        jobId: ctx.jobId,
        provider: res.provider,
        model: res.model,
        rationale: out.rationale.trim(),
      },
      instruction: input.instruction,
      jobId: ctx.jobId,
    }),
  );
  await ctx.progress(100);
  return { directionNumber: row.number, slides: slides.length, costMicroUsd: res.costMicroUsd };
}

/** Flat model slots → slide slots of the layout (unknown slots and image slots dropped). */
export function slotsFromOutput(
  layout: LayoutDef,
  out: { name: string; text: string; items: string[] }[],
  keep: Record<string, SlotValue> = {},
): Record<string, SlotValue> {
  const slots: Record<string, SlotValue> = {};
  for (const def of layout.slots) {
    if (def.name in keep) {
      slots[def.name] = keep[def.name]!;
      continue;
    }
    if (def.type === "image") continue;
    const o = out.find((x) => x.name === def.name);
    if (!o) continue;
    if (def.type === "text") {
      const t = o.text.trim() || o.items.join("\n").trim();
      if (t) slots[def.name] = t;
    } else {
      const items = (o.items.length ? o.items : o.text.split("\n"))
        .map((x) => x.trim())
        .filter(Boolean);
      if (items.length) slots[def.name] = items.slice(0, def.maxItems);
    }
  }
  return slots;
}

/** Output schema that also checks every slide against its layout, so the gateway retries with the exact errors. */
function slidesSchemaFor(m: TemplateManifest, outline: Outline) {
  const slide = buildSlideSchema(m);
  return slidesOutputSchema.superRefine((out, zctx) => {
    if (out.slides.length !== outline.rows.length)
      zctx.addIssue({
        code: "custom",
        path: ["slides"],
        message: `Exactly ${outline.rows.length} slides are needed, one per outline row`,
      });
    out.slides.forEach((s, i) => {
      const layout = findLayout(m, outline.rows[i]?.layout ?? s.layout) ?? findLayout(m, s.layout);
      if (!layout) {
        zctx.addIssue({
          code: "custom",
          path: ["slides", i, "layout"],
          message: `Layout "${s.layout}" does not exist`,
        });
        return;
      }
      const r = slide.safeParse({ layout: layout.id, slots: slotsFromOutput(layout, s.slots) });
      if (!r.success)
        for (const issue of r.error.issues)
          if (issue.path[1] !== undefined || issue.message.includes("caratteri"))
            zctx.addIssue({
              code: "custom",
              path: ["slides", i, "slots"],
              message: `Slide ${i + 1}: ${issue.message}`,
            });
    });
  }) as unknown as z.ZodType<SlidesOutput>;
}

export async function runGenerateSlides(
  deps: PipelineDeps,
  ctx: PipelineContext,
  input: { clientId: string; contentId: string },
) {
  const ai = requireAi(deps);
  return locked(deps, ctx, input.contentId, async () => {
    const s = await carouselSetup(deps, ctx, input.clientId, input.contentId);
    const outline = outlineOf(s.c);
    if (!outline || !s.c.outlineApprovedAt)
      throw attention("content.jobErrors.approveOutlineFirst");
    const m = s.template.manifest;
    await ctx.progress(10);
    const { system, prefix } = withBrand(SLIDES_SYSTEM, s.brandCtx);
    const req = {
      task: "slides" as const,
      schemaName: "carousel_slides",
      system,
      input: prefix + slidesUserPrompt(s.promptInput, outline),
      ...s.common,
      inputSummary: {
        fields: { outline: JSON.stringify(outline.rows) },
        meta: { promptVersion: CONTENT_PROMPT_VERSION, template: m.id, version: m.version },
      },
    };
    let res;
    try {
      res = await ai.generateObject({ ...req, schema: slidesSchemaFor(m, outline) });
    } catch (err) {
      // Still over the limits after the retry: keep the text, the editor flags what to cut.
      if (!(err instanceof AiProviderError && err.kind === "invalid_output"))
        return guarded(() => Promise.reject(err));
      res = await guarded(() => ai.generateObject({ ...req, schema: slidesOutputSchema }));
    }
    await ctx.progress(80);

    const brief = briefSchema.parse(s.c.brief ?? {});
    const slides: ContentSlide[] = outline.rows.map((row, i) => {
      const out = res.data.slides[i];
      const layout = findLayout(m, row.layout) ?? pickLayout(m, row.role, i, outline.rows.length);
      return {
        id: newSlideId(),
        layout: layout.id,
        tone: "default",
        role: layout.role,
        slots: slotsFromOutput(layout, out?.slots ?? []),
        protectedSlots: [],
        ...(out?.imageBriefs.length
          ? {
              note: out.imageBriefs
                .map((b) => deliverableText(s.c.language)("carousel.imageNote", b))
                .join("\n")
                .slice(0, 300),
            }
          : {}),
      };
    });
    const doc: CarouselDocument = {
      title: s.c.title,
      slides,
      caption: brief.outputs.caption ? res.data.caption.trim() : "",
      hashtags: [...new Set(res.data.hashtags.map(normalizeHashtag).filter(Boolean))].slice(
        0,
        brief.outputs.hashtags,
      ),
    };
    const product = s.c.productId
      ? await productSource().get(deps.db, s.c.clientId, s.c.productId)
      : null;
    await deps.db.transaction(async (tx) => {
      await tx
        .update(contents)
        .set({
          draft: doc as unknown as Record<string, unknown>,
          draftRev: sql`${contents.draftRev} + 1`,
          draftUpdatedBy: null,
          draftUpdatedAt: new Date(),
          templateVersion: m.version,
          brandVersionId: s.brandCtx.versionId,
          ...(product ? { productRevision: product.revision } : {}),
          ...(s.c.status === "approved" || s.c.status === "exported"
            ? { status: "draft" as const }
            : {}),
        })
        .where(eq(contents.id, s.c.id));
      const fresh = await getContentRow(tx, s.c.clientId, s.c.id);
      await createVersion(tx, {
        content: fresh,
        document: doc,
        origin: "ai",
        actor: s.actor,
        meta: { provider: res.provider, models: [res.model], jobId: ctx.jobId },
      });
    });
    await ctx.progress(100);
    return { slides: slides.length, costMicroUsd: res.costMicroUsd };
  });
}

/** A person asks the Copywriter to change one slide; the job applies it as an undoable edit. */
export async function requestSlideEdit(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string; slideId: string; instruction: string },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  const c = await getContentRow(db, input.clientId, input.id);
  if (isLocked(c)) invalid("content.errors.aiAlreadyWorking");
  const instruction = input.instruction.trim();
  if (instruction.length < 3 || instruction.length > 500)
    invalid("content.errors.instructionLength");
  if (!parseDocument(c.draft).slides.some((s) => s.id === input.slideId))
    notFound("content.errors.slideNotFound");
  const [row] = await db
    .insert(contentSlideEdits)
    .values({ contentId: c.id, slideId: input.slideId, instruction, createdBy: actor.id })
    .returning();
  return row!;
}

export async function runEditSlide(
  deps: PipelineDeps,
  ctx: PipelineContext,
  input: { clientId: string; contentId: string; editId: string },
) {
  const ai = requireAi(deps);
  return locked(deps, ctx, input.contentId, async () => {
    const [edit] = await deps.db
      .select()
      .from(contentSlideEdits)
      .where(
        and(
          eq(contentSlideEdits.id, input.editId),
          eq(contentSlideEdits.contentId, input.contentId),
        ),
      );
    if (!edit || edit.status !== "queued") return { skipped: true };
    const fail = async (key: JobErrorKey) => {
      const error = attention(key);
      await deps.db
        .update(contentSlideEdits)
        .set({ status: "failed", note: error.message, noteRef: error.ref, jobId: ctx.jobId })
        .where(eq(contentSlideEdits.id, edit.id));
      throw error;
    };
    try {
      const s = await carouselSetup(deps, ctx, input.clientId, input.contentId);
      const doc = parseDocument(s.c.draft);
      const i = doc.slides.findIndex((x) => x.id === edit.slideId);
      if (i < 0) return fail("content.jobErrors.slideGone");
      const slide = doc.slides[i]!;
      const layout = findLayout(s.template.manifest, slide.layout);
      if (!layout) return fail("content.jobErrors.layoutNotInTemplate");
      const keep: Record<string, SlotValue> = {};
      for (const def of layout.slots)
        if (def.type === "image" || slide.protectedSlots.includes(def.name)) {
          const v = slide.slots[def.name];
          if (v !== undefined) keep[def.name] = v;
        }
      const check = buildSlideSchema(s.template.manifest);
      const schema = editSlideOutputSchema.superRefine((out, zctx) => {
        const r = check.safeParse({
          layout: layout.id,
          slots: slotsFromOutput(layout, out.slots, keep),
        });
        if (!r.success)
          for (const issue of r.error.issues)
            zctx.addIssue({ code: "custom", path: ["slots"], message: issue.message });
      });
      await ctx.progress(10);
      const { system, prefix } = withBrand(EDIT_SLIDE_SYSTEM, s.brandCtx);
      const res = await guarded(() =>
        ai.generateObject({
          task: "edit_slide",
          schema,
          schemaName: "slide_edit",
          system,
          input:
            prefix +
            editSlideUserPrompt({
              layout,
              current: slide.slots,
              protectedSlots: slide.protectedSlots,
              instruction: edit.instruction,
              position: `${i + 1} of ${doc.slides.length}`,
              language: s.promptInput.language,
            }),
          ...s.common,
          inputSummary: {
            fields: { instruction: edit.instruction },
            meta: { promptVersion: CONTENT_PROMPT_VERSION, slide: i + 1 },
          },
        }),
      );
      const after: ContentSlide = {
        ...slide,
        slots: slotsFromOutput(layout, res.data.slots, keep),
      };
      doc.slides[i] = after;
      await deps.db.transaction(async (tx) => {
        await tx
          .update(contents)
          .set({
            draft: doc as unknown as Record<string, unknown>,
            draftRev: sql`${contents.draftRev} + 1`,
            draftUpdatedAt: new Date(),
          })
          .where(eq(contents.id, s.c.id));
        await tx
          .update(contentSlideEdits)
          .set({
            status: "applied",
            before: slide as unknown as Record<string, unknown>,
            after: after as unknown as Record<string, unknown>,
            note: res.data.note.trim().slice(0, 300),
            jobId: ctx.jobId,
            model: res.model,
          })
          .where(eq(contentSlideEdits.id, edit.id));
      });
      await ctx.progress(100);
      return { slideId: edit.slideId, costMicroUsd: res.costMicroUsd };
    } catch (err) {
      if (err instanceof NeedsAttentionError) {
        await deps.db
          .update(contentSlideEdits)
          .set({
            status: "failed",
            note: err.message.slice(0, 300),
            noteRef: err.ref ?? null,
            jobId: ctx.jobId,
          })
          .where(and(eq(contentSlideEdits.id, edit.id), eq(contentSlideEdits.status, "queued")));
      }
      throw err;
    }
  });
}

// ---- Art Director: images ----

/** Request size for the slide's format (providers support portrait, square and landscape). */
export function imageSizeFor(format: FormatId) {
  const f = FORMATS[format];
  const r = f.height / f.width;
  if (r > 1.2) return { w: 1024, h: 1536 };
  if (r < 0.83) return { w: 1536, h: 1024 };
  return { w: 1024, h: 1024 };
}

function imageryGuidelines(identity: PublishedBrandIdentity): string {
  const im = identity.document.visual.imagery?.value;
  if (!im) return "";
  const line = (label: string, xs: string[]) => (xs.length ? `${label}: ${xs.join("; ")}` : "");
  return [
    line("Subjects", im.subjects),
    line("Settings", im.settings),
    line("Framing", im.framing),
    line("Light", im.lighting),
    line("Colors", im.colorMood),
    im.people ? `People: ${im.people}` : "",
    im.illustration ? `Illustration: ${im.illustration}` : "",
    line("Forbidden", im.forbidden),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Image route allowed by commercial use: providers whose terms the agency rejected are
 * dropped; pending ones are allowed and the image carries a warning until verified.
 */
export async function imageRouteFor(
  db: Database,
  clientId: string,
  route: ModelRef[] | undefined,
): Promise<{ route: TaskRoute; status: Map<ProviderId, string> } | null> {
  if (!route?.length) return null;
  const status = new Map<ProviderId, string>();
  const allowed: ModelRef[] = [];
  for (const m of route) {
    const s = await commercialUseFor(db, m.provider, clientId);
    status.set(m.provider, s);
    if (s !== "rejected") allowed.push(m);
  }
  if (!allowed.length) return { route: { primary: route[0]! }, status };
  return {
    route: { primary: allowed[0]!, ...(allowed[1] ? { fallback: allowed[1] } : {}) },
    status,
  };
}

export async function runGenerateImage(
  deps: PipelineDeps,
  ctx: PipelineContext,
  input: {
    clientId: string;
    contentId: string;
    slideId: string;
    slot: string;
    brief: string;
    variants: number;
  },
) {
  const ai = requireAi(deps);
  const actor = agent("art_director", ctx);
  const client = await requireClient(deps.db, input.clientId);
  const c = await getContentRow(deps.db, input.clientId, input.contentId);
  const template = await getTemplate(deps.db, input.clientId, c.templateKey, c.templateVersion);
  const doc = parseDocument(c.draft);
  const slide = doc.slides.find((s) => s.id === input.slideId);
  const layout = slide ? findLayout(template.manifest, slide.layout) : undefined;
  if (!slide || !layout?.slots.some((s) => s.name === input.slot && s.type === "image"))
    throw attention("content.jobErrors.imageSlotNotFound");
  const route = deps.resolveImageRoute ? await deps.resolveImageRoute(deps.db) : deps.imageRoute;
  const routed = await imageRouteFor(deps.db, input.clientId, route);
  if (!routed) throw attention("content.jobErrors.noImageProvider");
  const primaryCommercialUse = routed.status.get(routed.route.primary.provider);
  if (primaryCommercialUse === "rejected")
    throw attention("content.jobErrors.commercialUseRejected");
  if (primaryCommercialUse !== "verified")
    throw attention("content.jobErrors.commercialUsePendingVerification");
  const identity = await publishedIdentity(deps.db, actor, input.clientId);
  const common: CommonAi = {
    clientId: input.clientId,
    clientPolicy: client.aiPolicy,
    sends: SENDS_BRAND_TEXTS,
    authorizedBy: ctx.requestedBy,
    jobId: ctx.jobId,
    contentId: input.contentId,
  };
  const direction = directionBlock(
    await acceptedDirection(deps.db, c.id),
    doc.slides.indexOf(slide) + 1,
  );
  const slideText = Object.values(slide.slots)
    .flatMap((v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v : []))
    .join("\n")
    .slice(0, 1000);
  await ctx.progress(5);
  const prompt = await guarded(() =>
    ai.generateObject({
      task: "image_prompt",
      schema: imagePromptOutputSchema,
      schemaName: "image_prompt",
      system: IMAGE_PROMPT_SYSTEM,
      input: imagePromptUserPrompt({
        brief: input.brief,
        slideText,
        imagery: imageryGuidelines(identity),
        language: c.language,
        direction,
      }),
      ...common,
      inputSummary: {
        fields: { brief: input.brief },
        meta: { promptVersion: CONTENT_PROMPT_VERSION },
      },
    }),
  );
  await ctx.progress(20);
  const res = await guarded(() =>
    ai.generateImage({
      prompt: prompt.data.prompt,
      size: imageSizeFor(c.format as FormatId),
      variants: Math.min(4, Math.max(1, input.variants)) as 1 | 2 | 3 | 4,
      route: routed.route,
      ...common,
      inputSummary: {
        fields: { prompt: prompt.data.prompt },
        meta: { promptVersion: CONTENT_PROMPT_VERSION, slot: input.slot },
      },
    }),
  );
  await ctx.progress(85);
  const commercialUse = routed.status.get(res.provider) ?? "pending_verification";
  const ids: string[] = [];
  for (const [n, img] of res.images.entries()) {
    const { row } = await storeAsset(deps.db, deps.storage, {
      clientId: input.clientId,
      bytes: img.data,
      declaredMime: img.mimeType,
      source: "ai",
      status: "draft",
      alt: prompt.data.alt,
      tags: ["ai"],
      generation: {
        brief: input.brief,
        prompt: prompt.data.prompt,
        provider: res.provider,
        model: res.model,
        costMicroUsd: Math.round((res.costMicroUsd + prompt.costMicroUsd) / res.images.length),
        variant: n + 1,
        slideId: input.slideId,
        slot: input.slot,
        commercialUse,
        promptVersion: CONTENT_PROMPT_VERSION,
        createdAt: new Date().toISOString(),
      },
      contentId: input.contentId,
      jobId: ctx.jobId,
      createdBy: null,
    });
    ids.push(row.id);
  }
  await ctx.progress(100);
  return {
    assets: ids,
    provider: res.provider,
    commercialUse,
    costMicroUsd: res.costMicroUsd + prompt.costMicroUsd,
  };
}
