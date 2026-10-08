"use server";

import { getDefaultAiPolicy } from "@forgecy/ai";
import { brandCrawlWebsiteJob, findOrCreateWebsiteSource } from "@forgecy/brand";
import { aiPolicies, assertCan, clientStatuses } from "@forgecy/core";
import { clients, eq, getDb, recordAuditEvent } from "@forgecy/db";
import { enqueueJob } from "@forgecy/jobs";
import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { firstIssue, vmsg } from "@/lib/i18n";
import { getQueues } from "@/lib/queues";
import { requireUser } from "@/lib/session";
import { slugify } from "@/lib/slug";

const optionalUrl = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .pipe(z.url({ protocol: /^https?$/, message: vmsg("validation.websiteInvalid") }).optional());

const clientSchema = z.object({
  name: z.string().trim().min(1, vmsg("validation.nameRequired")).max(120),
  status: z.enum(clientStatuses).default("prospect"),
  websiteUrl: optionalUrl,
  sector: z.string().trim().max(80).optional(),
  aiPolicy: z.enum(aiPolicies).optional(),
});

export type ClientFormState = { error?: string; ok?: boolean };

export async function createClientAction(
  _prev: ClientFormState,
  form: FormData,
): Promise<ClientFormState> {
  const user = await requireUser();
  assertCan(user.actor, "project.edit");
  const parsed = clientSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: await firstIssue(parsed.error) };

  const db = getDb();
  const { policy: defaultPolicy } = await getDefaultAiPolicy(db);
  const aiPolicy = parsed.data.aiPolicy ?? defaultPolicy;
  // Anyone gets the Admin's default; choosing another policy is an Admin decision.
  if (aiPolicy !== defaultPolicy) assertCan(user.actor, "ai.policies.manage");
  const base = slugify(parsed.data.name) || "client";
  let slug = base;
  for (
    let i = 2;
    await db.query.clients.findFirst({ where: eq(clients.slug, slug), columns: { id: true } });
    i++
  ) {
    slug = `${base}-${i}`;
  }

  const { id: clientId } = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(clients)
      .values({
        ...parsed.data,
        aiPolicy,
        sector: parsed.data.sector || null,
        websiteUrl: parsed.data.websiteUrl ?? null,
        slug,
      })
      .returning({ id: clients.id });
    await recordAuditEvent(tx, {
      actor: user.actor,
      action: "client.create",
      entity: "client",
      entityId: row!.id,
      clientId: row!.id,
      meta: { status: parsed.data.status, aiPolicy },
    });
    return row!;
  });

  if (parsed.data.websiteUrl) {
    const source = await findOrCreateWebsiteSource(db, user.actor, {
      clientId,
      websiteUrl: parsed.data.websiteUrl,
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
  revalidatePath("/clients");
  return { ok: true };
}
