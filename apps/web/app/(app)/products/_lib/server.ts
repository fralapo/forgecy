import "server-only";
import {
  catalogImportJob,
  importAiSetup,
  isImportError,
  type ActingUser,
  type ApprovalBlocker,
  type EnqueueImportStep,
} from "@forgecy/catalog";
import type { FieldKey } from "@forgecy/catalog/fields";
import { ForgecyError, PermissionDeniedError, type MessageRef } from "@forgecy/core";
import { clients, eq, getDb } from "@forgecy/db";
import { createStorageFromEnv, type StorageDriver } from "@forgecy/files";
import { cancelJob, enqueueJob } from "@forgecy/jobs";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentRouting } from "@/lib/ai";
import { env } from "@/lib/env";
import { errorMessage, refText } from "@/lib/i18n";
import { getQueues } from "@/lib/queues";
import { type CurrentUser, requireUser } from "@/lib/session";
import { blockerText, fieldLabel } from "./labels";
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
  const { routing } = await currentRouting();
  return {
    user,
    acting: actingUser(user),
    client,
    ai: importAiSetup(env, client.aiPolicy, routing),
  };
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

/** A catalog error in the user's language, or null when it is not a domain error. */
export async function catalogErrorText(err: unknown): Promise<string | null> {
  const t = await getTranslations("products");
  if (err instanceof PermissionDeniedError) return t("errors.permission");
  if (isImportError(err))
    return t("errors.withCode", { message: await refText(err.ref, err.message), code: err.code });
  if (!(err instanceof ForgecyError)) return null;
  const blocker = err.details?.blocker as ApprovalBlocker | undefined;
  if (blocker) return blockerText(t, blocker);
  const field = err.details?.field;
  if (err.ref && typeof field === "string")
    // The field travels as a key: name it in the user's language.
    return refText(
      { ...err.ref, values: { ...err.ref.values, field: fieldLabel(t, field as FieldKey) } },
      err.message,
    );
  return (await errorMessage(err)) ?? err.message;
}

/** Text of an item left out of a bulk action (stale, wrong status, blocked...). */
export async function skippedText(r: {
  reason: string;
  ref?: MessageRef;
  blocker?: ApprovalBlocker;
}): Promise<string> {
  if (r.blocker) return blockerText(await getTranslations("products"), r.blocker);
  return refText(r.ref, r.reason);
}

/** Runs a catalog operation for a server action and turns domain errors into a message. */
export async function attempt(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const message = await fn();
    return { ok: true, ...(message ? { message } : {}) };
  } catch (err) {
    const error = await catalogErrorText(err);
    if (error !== null) return { error };
    throw err;
  }
}

/** Upload routes: file problems (too large, unreadable, disk full) become a readable 4xx/5xx. */
export async function importErrorResponse(err: unknown): Promise<Response | null> {
  if (!isImportError(err)) return null;
  const status = err.code === "DISK-FULL" ? 507 : err.code === "IMPORT-TOO-LARGE" ? 413 : 422;
  return Response.json(
    { error: err.code, message: await refText(err.ref, err.message) },
    { status },
  );
}
