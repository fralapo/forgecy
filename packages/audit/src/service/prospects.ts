import {
  aiPolicies,
  assertCan,
  ForgecyError,
  prospectObjectives,
  socialChannels,
  type Actor,
  type AiPolicy,
  type SocialChannel,
} from "@forgecy/core";
import {
  and,
  auditSources,
  audits,
  clients,
  eq,
  inArray,
  isNull,
  jobs,
  ne,
  or,
  prospectProfiles,
  recordAuditEvent,
  sql,
  type Database,
} from "@forgecy/db";
import { cancelJob } from "@forgecy/jobs";
import { z } from "zod";
import { domainOf, isPlatformUrl, normalizeSiteUrl } from "../url";
import { requireQueues, userIdOf, type AuditDeps } from "./common";

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
      ctx.addIssue({ code: "custom", message: "Invalid website address" });
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
          message: `The link is not a ${channelLabel[channel]} profile`,
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
    name: z.string().trim().min(1, "Enter the name").max(120),
    websiteUrl: siteUrl,
    sector: optionalText(80),
    area: optionalText(120),
    objectives: z.array(z.enum(prospectObjectives)).max(6).default([]),
    otherObjective: optionalText(200),
    notes: optionalText(4000),
    reportLanguage: z.enum(["it", "en"]).default("en"),
    ownerId: z.uuid().optional(),
    socialUrls: socialUrlsSchema,
    aiPolicy: z.enum(aiPolicies).default("external_allowed"),
  })
  .superRefine((v, ctx) => {
    if (v.objectives.includes("other") && !v.otherObjective)
      ctx.addIssue({
        code: "custom",
        path: ["otherObjective"],
        message: "Describe the objective",
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

/** Prospects or clients with the same site domain or the same name (Page 5 warning). */
export async function findDuplicates(
  db: Database,
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
    .where(and(or(...conds), excludeId ? ne(clients.id, excludeId) : undefined))
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
  if (data.aiPolicy !== "external_allowed") assertCan(actor, "ai.policies.manage");
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
        aiPolicy: data.aiPolicy,
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
    await recordAuditEvent(tx, {
      actor,
      action: "prospect.create",
      entity: "client",
      entityId: id,
      clientId: id,
      meta: { aiPolicy: data.aiPolicy },
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
    if (!profile)
      throw new ForgecyError(
        "conflict",
        "Someone changed this data in the meantime. Reload the page to see the updated version.",
      );
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
  if (!before) throw new ForgecyError("not_found", "Prospect not found");
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
  if (!client) throw new ForgecyError("not_found", "Prospect not found");
  if (client.status !== "prospect")
    throw new ForgecyError("conflict", `${client.name} is already a client.`);
  if (client.archivedAt)
    throw new ForgecyError("conflict", "The prospect is archived: restore it first.");
  const delivered = await deps.db.query.audits.findFirst({
    where: and(eq(audits.clientId, clientId), eq(audits.status, "delivered")),
  });
  if (!delivered) throw new ForgecyError("conflict", "Deliver the report first.");
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(clients)
      .set({ status: "active", updatedAt: new Date() })
      .where(and(eq(clients.id, clientId), eq(clients.status, "prospect")))
      .returning({ id: clients.id, slug: clients.slug, name: clients.name });
    if (!row) throw new ForgecyError("conflict", `${client.name} is already a client.`);
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
  if (!client) throw new ForgecyError("not_found", "Prospect not found");
  if (client.status !== "prospect")
    throw new ForgecyError("conflict", "Only prospects can be deleted.");
  if (confirmName.trim() !== client.name)
    throw new ForgecyError("validation", "Type the exact prospect name to confirm.");
  const files = await deps.db
    .select({ key: auditSources.storageKey, mobile: auditSources.storageKeyMobile })
    .from(auditSources)
    .innerJoin(audits, eq(audits.id, auditSources.auditId))
    .where(eq(audits.clientId, clientId));
  await deps.db.transaction(async (tx) => {
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
