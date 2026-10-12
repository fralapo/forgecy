import "server-only";
import { getDefaultAiPolicy } from "@forgecy/ai";
import { brandCrawlWebsiteJob, findOrCreateWebsiteSource } from "@forgecy/brand";
import { actorWithClient, aiPolicies, assertCan, clientStatuses } from "@forgecy/core";
import { clients, eq, getDb, grantClientAccess, recordAuditEvent } from "@forgecy/db";
import { enqueueJob } from "@forgecy/jobs";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { uniqueSlug } from "./brand-name";
import { vmsg } from "./i18n";
import { getQueues } from "./queues";
import { slugify } from "./slug";
import type { CurrentUser } from "./session";

/** http(s) addresses only; empty means none. */
export const optionalWebsiteUrl = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .pipe(z.url({ protocol: /^https?$/, message: vmsg("validation.websiteInvalid") }).optional());

export const clientSchema = z.object({
  name: z.string().trim().min(1, vmsg("validation.nameRequired")).max(120),
  status: z.enum(clientStatuses).default("prospect"),
  websiteUrl: optionalWebsiteUrl,
  sector: z.string().trim().max(80).optional(),
  aiPolicy: z.enum(aiPolicies).optional(),
});

export type NewClient = z.infer<typeof clientSchema>;

/**
 * Creates a client for the signed-in person: the person may open it (ADR 0020) and, when a
 * website is given, its first scan is queued on their behalf, so the import applies itself
 * with them as approver (ADR 0022). The one place clients are created from the web app.
 */
export async function createClientFor(
  user: CurrentUser,
  input: NewClient,
): Promise<{ id: string; slug: string }> {
  assertCan(user.actor, "project.edit");
  const db = getDb();
  const { policy: defaultPolicy } = await getDefaultAiPolicy(db);
  const aiPolicy = input.aiPolicy ?? defaultPolicy;
  // Anyone gets the Admin's default; choosing another policy is an Admin decision.
  if (aiPolicy !== defaultPolicy) assertCan(user.actor, "ai.policies.manage");
  const slug = await uniqueSlug(
    slugify(input.name) || "client",
    async (s) =>
      !!(await db.query.clients.findFirst({ where: eq(clients.slug, s), columns: { id: true } })),
  );

  const { id: clientId } = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(clients)
      .values({
        ...input,
        aiPolicy,
        sector: input.sector || null,
        websiteUrl: input.websiteUrl ?? null,
        slug,
      })
      .returning({ id: clients.id });
    // Whoever creates a client can open it (ADR 0020).
    await grantClientAccess(tx, { userId: user.id, clientId: row!.id, createdBy: user.id });
    await recordAuditEvent(tx, {
      actor: user.actor,
      action: "client.create",
      entity: "client",
      entityId: row!.id,
      clientId: row!.id,
      meta: { status: input.status, aiPolicy },
    });
    return row!;
  });

  if (input.websiteUrl) {
    // The actor was read before the client existed; its creator was just given access.
    const source = await findOrCreateWebsiteSource(db, actorWithClient(user.actor, clientId), {
      clientId,
      websiteUrl: input.websiteUrl,
    });
    await enqueueJob(db, await getQueues(), {
      kind: brandCrawlWebsiteJob,
      payload: {
        clientId,
        sourceId: source.id,
        requestedBy: user.id,
        language: await getLocale(),
      },
      clientId,
      entity: "brand_source",
      entityId: source.id,
      createdBy: user.id,
    });
  }
  return { id: clientId, slug };
}
