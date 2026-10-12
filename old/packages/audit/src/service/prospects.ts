import {
  aiPolicies,
  assertCan,
  prospectObjectives,
  socialChannels,
  type Actor,
  type AiPolicy,
  type SocialChannel,
} from "@forgecy/core";
import { getDefaultAiPolicy } from "@forgecy/ai";
import { localizedError } from "@forgecy/i18n";
import {
  and,
  auditSources,
  audits,
  clients,
  clientScopeWhere,
  eq,
  grantClientAccess,
  inArray,
  isNull,
  jobs,
  ne,
  or,
  prospectProfiles,
  recordAuditEvent,
  sql,
  templates,
  type Database,
} from "@forgecy/db";
import { cancelJob } from "@forgecy/jobs";
import { z } from "zod";
import { domainOf, isPlatformUrl, normalizeSiteUrl } from "../url";
import { issueKey, requireQueues, userIdOf, type AuditDeps } from "./common";

/** URL-safe slug from a display name ("Caffè Rossi & Co." → "caffe-rossi-co"). */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const siteUrl = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return undefined;
    const url = normalizeSiteUrl(v);
    if (!url) {
      ctx.addIssue({ code: "custom", message: issueKey("audit.validation.websiteInvalid") });
      return z.NEVER;
    }
    return url;
  });

const socialUrlsSchema = z
  .partialRecord(z.enum(socialChannels), z.string().trim())
  .optional()
  .transform((input, ctx) => {
    const out: Partial<Record<SocialChannel, string>> = {};
    for (const channel of socialChannels) {
      const raw = input?.[channel];
      if (!raw) continue;
      const url = normalizeSiteUrl(raw);
      if (!url || !isPlatformUrl(channel, url)) {
        ctx.addIssue({
          code: "custom",
          path: [channel],
          message: issueKey("audit.validation.notAProfile", { channel: channelLabel[channel] }),
        });
        continue;
      }
      out[channel] = url;
    }
    return out;
  });

export const channelLabel: Record<SocialChannel | "website", string> = {
  website: "Website",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
};

export const prospectInputSchema = z
  .object({
    name: z.string().trim().min(1, issueKey("audit.validation.nameRequired")).max(120),
    websiteUrl: siteUrl,
    sector: optionalText(80),
    area: optionalText(120),
    objectives: z.array(z.enum(prospectObjectives)).max(6).default([]),
    otherObjective: optionalText(200),
    notes: optionalText(4000),
    reportLanguage: z.enum(["it", "en"]).default("en"),
    ownerId: z.uuid().optional(),
    socialUrls: socialUrlsSchema,
    /** Omitted: the default policy an Admin set for new clients. */
    aiPolicy: z.enum(aiPolicies).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.objectives.includes("other") && !v.otherObjective)
      ctx.addIssue({
        code: "custom",
        path: ["otherObjective"],
        message: issueKey("audit.validation.objectiveRequired"),
      });
  });
export type ProspectInput = z.input<typeof prospectInputSchema>;

export interface DuplicateMatch {
  id: string;
  name: string;
  slug: string;
  status: string;
  reason: "domain" | "name";
}

/**
 * Prospects or clients with the same site domain or the same name (Page 5 warning), among
 * the ones the actor may open: a hidden client is not revealed by its name (ADR 0020).
 */
export async function findDuplicates(
  db: Database,
  actor: Actor,
  input: { name?: string; websiteUrl?: string | null },
  excludeId?: string,
): Promise<DuplicateMatch[]> {
  const domain = domainOf(input.websiteUrl ? normalizeSiteUrl(input.websiteUrl) : null);
  const slug = input.name ? slugify(input.name) : "";
  if (!domain && !slug) return [];
  const conds = [];
  if (domain)
    conds.push(
      sql`lower(regexp_replace(substring(${clients.websiteUrl} from '^[a-z]+://([^/:]+)'), '^www\\.', '')) = ${domain}`,
    );
  if (slug) conds.push(or(eq(clients.slug, slug), sql`${clients.slug} like ${`${slug}-%`}`)!);
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      slug: clients.slug,
      status: clients.status,
      websiteUrl: clients.websiteUrl,
    })
    .from(clients)
    .where(
      and(
        or(...conds),
        excludeId ? ne(clients.id, excludeId) : undefined,
        clientScopeWhere(actor, clients.id),
      ),
    )
    .limit(5);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    reason: domain && domainOf(r.websiteUrl) === domain ? "domain" : "name",
  }));
}

/** Slugs taken by static routes under /audit. */
const RESERVED_SLUGS = new Set(["new", "upload", "archived"]);

async function uniqueSlug(db: Database, name: string): Promise<string> {
  const raw = slugify(name) || "prospect";
  const base = RESERVED_SLUGS.has(raw) ? `${raw}-prospect` : raw;
  let slug = base;
  for (
    let i = 2;
    await db.query.clients.findFirst({ where: eq(clients.slug, slug), columns: { id: true } });
    i++
  )
    slug = `${base}-${i}`;
  return slug;
}

/** Create a prospect (clients row with status prospect + profile). Policy needs an Admin. */
export async function createProspect(
  deps: AuditDeps,
  actor: Actor,
  input: ProspectInput,
): Promise<{ id: string; slug: string }> {
  assertCan(actor, "project.edit");
  const data = prospectInputSchema.parse(input);
  const { policy: defaultPolicy } = await getDefaultAiPolicy(deps.db);
  const aiPolicy = data.aiPolicy ?? defaultPolicy;
  // Anyone gets the Admin's default; choosing another policy is an Admin decision.
  if (aiPolicy !== defaultPolicy) assertCan(actor, "ai.policies.manage");
  const slug = await uniqueSlug(deps.db, data.name);
  const userId = userIdOf(actor);
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(clients)
      .values({
        name: data.name,
        slug,
        status: "prospect",
        websiteUrl: data.websiteUrl ?? null,
        sector: data.sector ?? null,
        notes: data.notes ?? null,
        aiPolicy,
      })
      .returning({ id: clients.id });
    const id = row!.id;
    await tx.insert(prospectProfiles).values({
      clientId: id,
      area: data.area ?? null,
      objectives: data.objectives,
      otherObjective: data.otherObjective ?? null,
      reportLanguage: data.reportLanguage,
      ownerId: data.ownerId ?? userId,
      socialUrls: data.socialUrls,
      updatedBy: userId,
    });
    // Whoever creates a client can open it (ADR 0020).
    if (userId) await grantClientAccess(tx, { userId, clientId: id, createdBy: userId });
    await recordAuditEvent(tx, {
      actor,
      action: "prospect.create",
      entity: "client",
      entityId: id,
      clientId: id,
      meta: { aiPolicy },
    });
    return { id, slug };
  });
}

/** Update prospect data with optimistic concurrency (`rev` from the form). */
export async function updateProspect(
  deps: AuditDeps,
  actor: Actor,
  clientId: string,
  input: Omit<ProspectInput, "aiPolicy">,
  rev: number,
): Promise<{ rev: number }> {
  assertCan(actor, "project.edit", clientId);
  const data = prospectInputSchema.parse(input);
  const userId = userIdOf(actor);
  return deps.db.transaction(async (tx) => {
    const [profile] = await tx
      .update(prospectProfiles)
      .set({
        area: data.area ?? null,
        objectives: data.objectives,
        otherObjective: data.otherObjective ?? null,
        reportLanguage: data.reportLanguage,
        ...(data.ownerId ? { ownerId: data.ownerId } : {}),
        socialUrls: data.socialUrls,
        updatedBy: userId,
        rev: sql`${prospectProfiles.rev} + 1`,
      })
      .where(and(eq(prospectProfiles.clientId, clientId), eq(prospectProfiles.rev, rev)))
      .returning({ rev: prospectProfiles.rev });
    if (!profile) throw localizedError("conflict", "audit.errors.dataConflict");
    await tx
      .update(clients)
      .set({
        name: data.name,
        websiteUrl: data.websiteUrl ?? null,
        sector: data.sector ?? null,
        notes: data.notes ?? null,
      })
      .where(eq(clients.id, clientId));
    await recordAuditEvent(tx, {
      actor,
      action: "prospect.update",
      entity: "client",
      entityId: clientId,
      clientId,
    });
    return profile;
  });
}

/**
 * Change the AI policy (Admin only). Moving to `no_ai` cancels the audit AI jobs
 * still waiting, so nothing is sent to a provider after the change.
 */
export async function setProspectPolicy(
  deps: AuditDeps,
  actor: Actor,
  clientId: string,
  policy: AiPolicy,
): Promise<{ cancelledJobs: number }> {
  assertCan(actor, "ai.policies.manage", clientId);
  const [before] = await deps.db
    .select({ aiPolicy: clients.aiPolicy })
    .from(clients)
    .where(eq(clients.id, clientId));
  if (!before) throw localizedError("not_found", "audit.errors.prospectNotFound");
  await deps.db.transaction(async (tx) => {
    await tx.update(clients).set({ aiPolicy: policy }).where(eq(clients.id, clientId));
    await recordAuditEvent(tx, {
      actor,
      action: "client.ai_policy.change",
      entity: "client",
      entityId: clientId,
      clientId,
      meta: { from: before.aiPolicy, to: policy },
    });
  });
  let cancelledJobs = 0;
  if (policy !== "external_allowed") {
    const pending = await deps.db
      .select({ id: jobs.id, kind: jobs.kind })
      .from(jobs)
      .where(and(eq(jobs.clientId, clientId), inArray(jobs.status, ["queued", "retrying"])));
    const queues = deps.queues ? requireQueues(deps) : null;
    for (const job of pending) {
      if (!job.kind.startsWith("audit.") || job.kind === "audit.crawl" || !queues) continue;
      if (await cancelJob(deps.db, queues, job.id)) cancelledJobs++;
    }
  }
  return { cancelledJobs };
}

export async function archiveProspect(deps: AuditDeps, actor: Actor, clientId: string) {
  assertCan(actor, "archive", clientId);
  await deps.db.transaction(async (tx) => {
    await tx
      .update(clients)
      .set({ archivedAt: new Date() })
      .where(and(eq(clients.id, clientId), isNull(clients.archivedAt)));
    await recordAuditEvent(tx, {
      actor,
      action: "prospect.archive",
      entity: "client",
      entityId: clientId,
      clientId,
    });
  });
}

export async function restoreProspect(deps: AuditDeps, actor: Actor, clientId: string) {
  assertCan(actor, "archive", clientId);
  await deps.db.transaction(async (tx) => {
    await tx.update(clients).set({ archivedAt: null }).where(eq(clients.id, clientId));
    await recordAuditEvent(tx, {
      actor,
      action: "prospect.restore",
      entity: "client",
      entityId: clientId,
      clientId,
    });
  });
}

/**
 * “Convert to client”: the prospect becomes an active client once an audit was
 * delivered (a final report exported). A person decides; agents are refused.
 * Audit, sources and accepted findings stay linked to the same client row.
 */
export async function convertToClient(
  deps: AuditDeps,
  actor: Actor,
  clientId: string,
): Promise<{ id: string; slug: string; name: string }> {
  assertCan(actor, "approve", clientId);
  const client = await deps.db.query.clients.findFirst({ where: eq(clients.id, clientId) });
  if (!client) throw localizedError("not_found", "audit.errors.prospectNotFound");
  if (client.status !== "prospect")
    throw localizedError("conflict", "audit.errors.alreadyClient", { name: client.name });
  if (client.archivedAt) throw localizedError("conflict", "audit.errors.prospectArchivedRestore");
  const delivered = await deps.db.query.audits.findFirst({
    where: and(eq(audits.clientId, clientId), eq(audits.status, "delivered")),
  });
  if (!delivered) throw localizedError("conflict", "audit.errors.deliverFirst");
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(clients)
      .set({ status: "active", updatedAt: new Date() })
      .where(and(eq(clients.id, clientId), eq(clients.status, "prospect")))
      .returning({ id: clients.id, slug: clients.slug, name: clients.name });
    if (!row) throw localizedError("conflict", "audit.errors.alreadyClient", { name: client.name });
    await recordAuditEvent(tx, {
      actor,
      action: "prospect.convert",
      entity: "client",
      entityId: clientId,
      clientId,
      meta: { auditId: delivered.id },
    });
    return row;
  });
}

/**
 * Delete a prospect and everything collected for it (only prospects, never clients).
 * Stored files go too: screenshots and uploads are personal data of the prospect.
 */
export async function deleteProspect(
  deps: AuditDeps,
  actor: Actor,
  clientId: string,
  confirmName: string,
): Promise<void> {
  assertCan(actor, "archive", clientId);
  const client = await deps.db.query.clients.findFirst({ where: eq(clients.id, clientId) });
  if (!client) throw localizedError("not_found", "audit.errors.prospectNotFound");
  if (client.status !== "prospect")
    throw localizedError("conflict", "audit.errors.onlyProspectsDeletable");
  if (confirmName.trim() !== client.name)
    throw localizedError("validation", "audit.errors.confirmName");
  const files = await deps.db
    .select({ key: auditSources.storageKey, mobile: auditSources.storageKeyMobile })
    .from(auditSources)
    .innerJoin(audits, eq(audits.id, auditSources.auditId))
    .where(eq(audits.clientId, clientId));
  await deps.db.transaction(async (tx) => {
    // Its private templates go with it: the foreign key would set `client_id` to null and turn
    // them into agency templates, shared with every client (ADR 0021).
    await tx.delete(templates).where(eq(templates.clientId, clientId));
    await tx.delete(clients).where(eq(clients.id, clientId));
    await recordAuditEvent(tx, {
      actor,
      action: "prospect.delete",
      entity: "client",
      entityId: clientId,
      meta: { name: client.name, files: files.length },
    });
  });
  if (deps.storage) {
    const keys = new Set(files.flatMap((f) => [f.key, f.mobile]).filter((k): k is string => !!k));
    for (const key of keys) await deps.storage.delete(key).catch(() => undefined);
  }
}
