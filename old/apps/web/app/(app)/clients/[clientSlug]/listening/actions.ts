"use server";

import {
  ForgecyError,
  PermissionDeniedError,
  canAccessClient,
  listeningStatuses,
} from "@forgecy/core";
import { clients, eq, getDb } from "@forgecy/db";
import { localizedError } from "@forgecy/i18n";
import {
  createSignal,
  deleteSignal,
  setSignalStatus,
  signalInputSchema,
  updateSignal,
  type SignalInput,
} from "@forgecy/social";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { errorMessage } from "@/lib/i18n";
import { requireUser } from "@/lib/session";

export type ActionResult = { ok: true } | { ok: false; error: string };

const slugSchema = z.string().regex(/^[a-z0-9-]{1,80}$/);
const uuid = z.uuid();

/** Runs a service call as the signed-in person; a refusal becomes a message. */
async function run(
  slug: string,
  fn: (ctx: {
    actor: Awaited<ReturnType<typeof requireUser>>["actor"];
    clientId: string;
  }) => Promise<void>,
): Promise<ActionResult> {
  slugSchema.parse(slug);
  const user = await requireUser();
  try {
    const [client] = await getDb().select().from(clients).where(eq(clients.slug, slug));
    // A client the person may not open is answered like one that does not exist (ADR 0020).
    if (!client || !canAccessClient(user.actor, client.id))
      throw localizedError("not_found", "social.errors.signalNotFound");
    await fn({ actor: user.actor, clientId: client.id });
    revalidatePath(`/clients/${slug}/listening`);
    return { ok: true };
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof ForgecyError)
      return { ok: false, error: (await errorMessage(err)) ?? err.message };
    throw err;
  }
}

async function checked(input: SignalInput) {
  const parsed = signalInputSchema.safeParse(input);
  return parsed.success
    ? null
    : { ok: false as const, error: (await getTranslations("clients.listening"))("invalid") };
}

export async function createSignalAction(slug: string, signal: SignalInput) {
  const bad = await checked(signal);
  if (bad) return bad;
  return run(slug, async ({ actor, clientId }) => {
    await createSignal(getDb(), actor, { clientId, signal });
  });
}

export async function updateSignalAction(slug: string, id: string, signal: SignalInput) {
  const bad = await checked(signal);
  if (bad) return bad;
  return run(slug, async ({ actor, clientId }) => {
    await updateSignal(getDb(), actor, { clientId, id: uuid.parse(id), signal });
  });
}

export async function markSignalAction(slug: string, id: string, status: string) {
  return run(slug, async ({ actor, clientId }) => {
    await setSignalStatus(getDb(), actor, {
      clientId,
      id: uuid.parse(id),
      status: z.enum(listeningStatuses).parse(status),
    });
  });
}

export async function deleteSignalAction(slug: string, id: string) {
  return run(slug, async ({ actor, clientId }) => {
    await deleteSignal(getDb(), actor, { clientId, id: uuid.parse(id) });
  });
}
