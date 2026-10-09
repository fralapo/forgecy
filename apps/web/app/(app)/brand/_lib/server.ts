import "server-only";
import {
  conflictsFor,
  getBrandWorkspace,
  listSources,
  parseDocument,
  defaultTokens,
  type BrandIdentityDocument,
  type TokenTree,
  type VersionRow,
} from "@forgecy/brand";
import { canAccessClient } from "@forgecy/core";
import { clients, eq, getDb, inArray, users } from "@forgecy/db";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";

export type Workspace = Awaited<ReturnType<typeof getBrandWorkspace>>;

/** Client, signed-in user and Brand Identity workspace for a `[clientSlug]` page. */
export async function loadBrand(slug: string) {
  const user = await requireUser();
  const db = getDb();
  const client = await db.query.clients.findFirst({ where: eq(clients.slug, slug) });
  // A client the person may not open looks like one that does not exist (ADR 0020).
  if (!client || !canAccessClient(user.actor, client.id)) notFound();
  const ws = await getBrandWorkspace(db, user.actor, client.id);
  return { db, user, client, ws };
}

export interface ShownVersion {
  /** The version on screen: the open draft, else the published one, else none yet. */
  version: VersionRow | null;
  editable: boolean;
  document: BrandIdentityDocument;
  tokens: TokenTree;
}

export function shownVersion(ws: Workspace, number?: number): ShownVersion {
  const pick =
    number !== undefined
      ? ws.versions.find((v) => v.number === number)
      : (ws.draft ?? ws.published);
  const version = pick ?? null;
  return {
    version,
    editable: !!version && (version.status === "draft" || version.status === "in_review"),
    document: parseDocument(version?.document),
    tokens: (version?.tokens as TokenTree | undefined) ?? defaultTokens(),
  };
}

/** Parses `?version=3`: a number shows that version read-only. */
export function versionParam(value: string | string[] | undefined): number | undefined {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export async function userNames(ids: Array<string | null | undefined>) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  const rows = await getDb()
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, list));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function sourcesFor(clientId: string) {
  const user = await requireUser();
  return listSources(getDb(), user.actor, clientId);
}

export async function openConflicts(clientId: string) {
  return conflictsFor(getDb(), clientId);
}
