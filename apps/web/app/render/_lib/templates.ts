import "server-only";
import { RENDER_CSP } from "@forgecy/carousel";
import { dbTemplateSource, getTemplateRow, loadTemplatePackage } from "@forgecy/carousel/catalog";
import { getDb } from "@forgecy/db";
import { createStorageFromEnv, type StorageDriver } from "@forgecy/files";
import { env } from "@/lib/env";

let storage: StorageDriver | undefined;
export function getStorage(): StorageDriver {
  storage ??= createStorageFromEnv(env);
  return storage;
}

/** Published templates (pinned versions also when archived): what editors and exports use. */
export function catalogSource() {
  return dbTemplateSource({ db: getDb(), storage: getStorage() });
}

/** Any version by row id, drafts included: catalog and template editor previews. */
export async function templateById(id: string) {
  const row = await getTemplateRow(getDb(), id);
  if (!row) return undefined;
  return { row, pkg: await loadTemplatePackage(getStorage(), row) };
}

/**
 * A rendered slide is served as its own document: same CSP the renderer writes in the
 * page (nothing but inline CSS and data: URLs) and framable only by Forgecy itself.
 */
export function slideResponse(html: string): Response {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": `${RENDER_CSP}; frame-ancestors 'self'`,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "private, no-store",
    },
  });
}
