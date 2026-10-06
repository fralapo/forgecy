import "server-only";
import { auditErrorCode, type AuditDeps } from "@forgecy/audit";
import { ForgecyError, PermissionDeniedError } from "@forgecy/core";
import { getDb } from "@forgecy/db";
import { createStorageFromEnv, type StorageDriver } from "@forgecy/files";
import { env } from "@/lib/env";
import { getQueues } from "@/lib/queues";

let storage: StorageDriver | undefined;

export function auditStorage(): StorageDriver {
  storage ??= createStorageFromEnv(env);
  return storage;
}

export async function auditDeps(): Promise<AuditDeps> {
  return { db: getDb(), queues: await getQueues(), storage: auditStorage() };
}

/** Read-only deps: no Redis connection needed to render a page. */
export function readDeps(): AuditDeps {
  return { db: getDb(), storage: auditStorage() };
}

/** Short-lived URL for a stored screenshot or file. */
export async function fileUrl(key: string | null | undefined, download?: string) {
  if (!key) return null;
  return auditStorage().signedUrl(key, {
    expiresInSeconds: 15 * 60,
    ...(download ? { disposition: "attachment" as const, filename: download } : {}),
  });
}

export type ActionResult<T = undefined> =
  { ok: true; data?: T; message?: string } | { ok: false; error: string; code?: string };

/** Map domain errors to a message people can act on, with the stable code. */
export function toActionError(err: unknown): { ok: false; error: string; code?: string } {
  const code = auditErrorCode(err) ?? undefined;
  if (err instanceof PermissionDeniedError)
    return { ok: false, error: "Non hai il permesso per questa azione.", code: "PERM-DENIED" };
  if (err instanceof ForgecyError)
    return { ok: false, error: err.message, ...(code ? { code } : {}) };
  if (err && typeof err === "object" && "issues" in err) {
    const issue = (err as { issues: Array<{ message: string }> }).issues[0];
    return { ok: false, error: issue?.message ?? "Dati non validi", code: "INPUT-INVALID" };
  }
  throw err;
}
