"use server";

import {
  ForgecyError,
  PermissionDeniedError,
  canAccessClient,
  socialProfileRoles,
} from "@forgecy/core";
import { clients, eq, getDb } from "@forgecy/db";
import { localizedError } from "@forgecy/i18n";
import {
  addProfile,
  liveSources,
  removeProfile,
  requestSnapshot,
  resumeProfile,
  resumeSource,
  updateProfile,
} from "@forgecy/social";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { errorMessage } from "@/lib/i18n";
import { getQueues } from "@/lib/queues";
import { requireUser } from "@/lib/session";

export type ActionResult = { ok: true } | { ok: false; error: string };

const slugSchema = z.string().regex(/^[a-z0-9-]{1,80}$/);
const uuid = z.uuid();

/** Runs a service call as the signed-in person and turns a refusal into a message. */
async function run(
  slug: string,
  fn: (ctx: {
    actor: Awaited<ReturnType<typeof requireUser>>["actor"];
    deps: () => Promise<{
      db: ReturnType<typeof getDb>;
      queues: Awaited<ReturnType<typeof getQueues>>;
    }>;
  }) => Promise<void>,
): Promise<ActionResult> {
  slugSchema.parse(slug);
  const user = await requireUser();
  try {
    await fn({
      actor: user.actor,
      deps: async () => ({ db: getDb(), queues: await getQueues() }),
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof ForgecyError)
      return { ok: false, error: (await errorMessage(err)) ?? err.message };
    throw err;
  } finally {
    // Also after a refusal: the profile may have been added before the first read failed to queue.
    revalidatePath(`/social/${slug}`, "layout");
  }
}

/** Adds the profile and queues its first read. */
export async function addProfileAction(slug: string, input: { handle: string; role: string }) {
  const role = z.enum(socialProfileRoles).parse(input.role);
  const handle = z.string().max(300).parse(input.handle);
  return run(slug, async ({ actor, deps }) => {
    const db = getDb();
    const client = await db.query.clients.findFirst({ where: eq(clients.slug, slug) });
    // A client the person may not open is answered like one that does not exist (ADR 0020).
    if (!client || !canAccessClient(actor, client.id))
      throw localizedError("not_found", "social.errors.profileNotFound");
    await addProfile(await deps(), actor, { clientId: client.id, handle, role, readNow: true });
  });
}

export async function readNowAction(slug: string, profileId: string) {
  const id = uuid.parse(profileId);
  return run(slug, async ({ actor, deps }) => {
    await requestSnapshot(await deps(), actor, id);
  });
}

/** Puts a paused or failed profile back in line and reads it again. */
export async function tryAgainAction(slug: string, profileId: string) {
  const id = uuid.parse(profileId);
  return run(slug, async ({ actor, deps }) => {
    const d = await deps();
    await resumeProfile(d, actor, id);
    await requestSnapshot(d, actor, id);
  });
}

export async function setMonitoredAction(slug: string, profileId: string, monitored: boolean) {
  const id = uuid.parse(profileId);
  return run(slug, async ({ actor }) => {
    await updateProfile({ db: getDb() }, actor, { profileId: id, monitored });
  });
}

export async function removeProfileAction(slug: string, profileId: string) {
  const id = uuid.parse(profileId);
  return run(slug, async ({ actor }) => {
    await removeProfile({ db: getDb() }, actor, id);
  });
}

export async function resumeSourceAction(slug: string, source: string) {
  const live = z.enum(liveSources).parse(source);
  return run(slug, async ({ actor }) => {
    await resumeSource({ db: getDb() }, actor, live);
  });
}
