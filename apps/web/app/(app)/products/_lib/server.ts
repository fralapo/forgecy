import "server-only";
import {
  catalogImportJob,
  importAiSetup,
  isImportError,
  type ActingUser,
  type EnqueueImportStep,
} from "@forgecy/catalog";
import { ForgecyError, PermissionDeniedError } from "@forgecy/core";
import { clients, eq, getDb } from "@forgecy/db";
import { createStorageFromEnv, type StorageDriver } from "@forgecy/files";
import { cancelJob, enqueueJob } from "@forgecy/jobs";
import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { getQueues } from "@/lib/queues";
import { type CurrentUser, requireUser } from "@/lib/session";
import type { ActionResult } from "./types";

export type CatalogClientRow = typeof clients.$inferSelect;

export function actingUser(user: CurrentUser): ActingUser {
  return { actor: user.actor, id: user.id, name: user.name };
}

/** The signed-in user and the client of the route; 404 for an unknown slug. */
export async function catalogPage(clientSlug: string) {
  const user = await requireUser();
  const client = await getDb().query.clients.findFirst({ where: eq(clients.slug, clientSlug) });
  if (!client) notFound();
  return { user, acting: actingUser(user), client, ai: importAiSetup(env, client.aiPolicy) };
}

let storage: StorageDriver | undefined;
export function getStorage(): StorageDriver {
  storage ??= createStorageFromEnv(env);
  return storage;
}

/** Short-lived URL for a private image (thumbnails, gallery, review). */
export async function imageUrl(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  return getStorage().signedUrl(key, { expiresInSeconds: 900 });
}

export const enqueueImportStep: EnqueueImportStep = async ({
  importId,
  clientId,
  phase,
  createdBy,
}) => {
  const job = await enqueueJob(getDb(), await getQueues(), {
    kind: catalogImportJob,
    payload: { importId, phase },
    clientId,
    entity: "product_import",
    entityId: importId,
    createdBy,
  });
  return job.id;
};

export async function cancelImportJob(jobId: string) {
  return cancelJob(getDb(), await getQueues(), jobId);
}

export type { ActionResult } from "./types";

const PERMISSION_TEXT = "AI agents can only propose: approving and archiving is up to a person.";

/** Runs a catalog operation for a server action and turns domain errors into a message. */
export async function attempt(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const message = await fn();
    return { ok: true, ...(message ? { message } : {}) };
  } catch (err) {
    if (err instanceof PermissionDeniedError) return { error: PERMISSION_TEXT };
    if (isImportError(err)) return { error: `${err.message} (${err.code})` };
    if (err instanceof ForgecyError) return { error: err.message };
    throw err;
  }
}

/** Upload routes: file problems (too large, unreadable, disk full) become a readable 4xx/5xx. */
export function importErrorResponse(err: unknown): Response | null {
  if (!isImportError(err)) return null;
  const status = err.code === "DISK-FULL" ? 507 : err.code === "IMPORT-TOO-LARGE" ? 413 : 422;
  return Response.json({ error: err.code, message: err.message }, { status });
}
