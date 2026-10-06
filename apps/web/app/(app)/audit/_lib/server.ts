import "server-only";
import { auditErrorCode, type AuditDeps } from "@forgecy/audit";
import { ForgecyError, PermissionDeniedError } from "@forgecy/core";
import { getDb } from "@forgecy/db";
import { createStorageFromEnv, type StorageDriver } from "@forgecy/files";
import type { ZodError } from "zod";
import { env } from "@/lib/env";
import { errorMessage, firstIssue } from "@/lib/i18n";
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

/** Map domain errors to a message people can act on (in their language), with the stable code. */
export async function toActionError(
  err: unknown,
): Promise<{ ok: false; error: string; code?: string }> {
  const code = auditErrorCode(err) ?? undefined;
  if (err instanceof PermissionDeniedError)
    return { ok: false, error: (await errorMessage(err)) ?? err.message, code: "PERM-DENIED" };
  if (err instanceof ForgecyError)
    return {
      ok: false,
      error: (await errorMessage(err)) ?? err.message,
      ...(code ? { code } : {}),
    };
  if (err && typeof err === "object" && "issues" in err)
    return { ok: false, error: await firstIssue(err as ZodError), code: "INPUT-INVALID" };
  throw err;
}
