"use server";

import { aiPolicies, assertCan, clientStatuses } from "@forgecy/core";
import { clients, eq, getDb, recordAuditEvent } from "@forgecy/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { firstIssue, vmsg } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { slugify } from "@/lib/slug";

const optionalUrl = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .pipe(z.url({ protocol: /^https?$/, message: vmsg("websiteInvalid") }).optional());

const clientSchema = z.object({
  name: z.string().trim().min(1, vmsg("nameRequired")).max(120),
  status: z.enum(clientStatuses).default("prospect"),
  websiteUrl: optionalUrl,
  sector: z.string().trim().max(80).optional(),
  aiPolicy: z.enum(aiPolicies).default("external_allowed"),
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
  const base = slugify(parsed.data.name) || "client";
  let slug = base;
  for (
    let i = 2;
    await db.query.clients.findFirst({ where: eq(clients.slug, slug), columns: { id: true } });
    i++
  ) {
    slug = `${base}-${i}`;
  }

  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(clients)
      .values({
        ...parsed.data,
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
      meta: { status: parsed.data.status, aiPolicy: parsed.data.aiPolicy },
    });
  });
  revalidatePath("/clients");
  return { ok: true };
}
