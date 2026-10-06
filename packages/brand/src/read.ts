/**
 * Stable read API of the Brand Identity module. Contents, carousels, the brand
 * check and exports read the *published* version through these functions only,
 * and store `versionId` on what they generate (content_versions.brand_identity_version_id).
 */
import { assertCan, type Actor, type BrandExampleKind } from "@forgecy/core";
import {
  and,
  brandExamples,
  brandIdentityProposals,
  brandIdentityVersions,
  brandSources,
  desc,
  eq,
  isNull,
  sql,
  type Database,
} from "@forgecy/db";
import { buildBrandContext, type BrandContext, type BrandContextOptions, type ContextExample } from "./context";
import { parseDocument, type BrandIdentityDocument } from "./document";
import type { TokenTree } from "./tokens";

export interface PublishedBrandIdentity {
  clientId: string;
  versionId: string;
  number: number;
  publishedAt: Date;
  document: BrandIdentityDocument;
  tokens: TokenTree;
}

type VersionRow = typeof brandIdentityVersions.$inferSelect;

const toPublished = (row: VersionRow): PublishedBrandIdentity => ({
  clientId: row.clientId,
  versionId: row.id,
  number: row.number,
  publishedAt: row.publishedAt ?? row.updatedAt,
  document: parseDocument(row.document),
  tokens: row.tokens as TokenTree,
});

/** The current published version, or null when the client has none (generation must stop). */
export async function getPublishedBrandIdentity(
  db: Database,
  actor: Actor,
  clientId: string,
): Promise<PublishedBrandIdentity | null> {
  assertCan(actor, "view", clientId);
  const [row] = await db
    .select()
    .from(brandIdentityVersions)
    .where(and(eq(brandIdentityVersions.clientId, clientId), eq(brandIdentityVersions.status, "published")));
  return row ? toPublished(row) : null;
}

/**
 * A specific approved version (published or archived), e.g. the one a carousel was
 * generated with. Drafts are not returned: only approved content reaches generation.
 */
export async function getBrandIdentityVersion(
  db: Database,
  actor: Actor,
  input: { clientId: string; versionId: string },
): Promise<PublishedBrandIdentity | null> {
  assertCan(actor, "view", input.clientId);
  const [row] = await db
    .select()
    .from(brandIdentityVersions)
    .where(
      and(
        eq(brandIdentityVersions.id, input.versionId),
        eq(brandIdentityVersions.clientId, input.clientId),
        sql`${brandIdentityVersions.status} in ('published', 'archived')`,
        sql`${brandIdentityVersions.publishedAt} is not null`,
      ),
    );
  return row ? toPublished(row) : null;
}

export async function listBrandExamples(
  db: Database,
  actor: Actor,
  clientId: string,
  filter: { kind?: BrandExampleKind; limit?: number } = {},
): Promise<ContextExample[]> {
  assertCan(actor, "view", clientId);
  const rows = await db
    .select()
    .from(brandExamples)
    .where(
      and(
        eq(brandExamples.clientId, clientId),
        isNull(brandExamples.archivedAt),
        filter.kind ? eq(brandExamples.kind, filter.kind) : undefined,
      ),
    )
    .orderBy(desc(brandExamples.createdAt))
    .limit(Math.min(filter.limit ?? 200, 500));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    verdict: r.verdict,
    body: r.body,
    reason: r.reason,
    channel: r.channel,
    pillarKey: r.pillarKey,
    formatKey: r.formatKey,
    createdAt: r.createdAt,
  }));
}

/**
 * Convenience for generation: published version + examples → brand block of the prompt.
 * Returns null when nothing is published.
 */
export async function loadBrandContext(
  db: Database,
  actor: Actor,
  clientId: string,
  options: Omit<BrandContextOptions, "examples"> = {},
): Promise<BrandContext | null> {
  const identity = await getPublishedBrandIdentity(db, actor, clientId);
  if (!identity) return null;
  const examples = await listBrandExamples(db, actor, clientId);
  return buildBrandContext(identity, { ...options, examples });
}

// ---- Workspace queries for the Brand Identity pages ----

export async function getBrandWorkspace(db: Database, actor: Actor, clientId: string) {
  assertCan(actor, "view", clientId);
  const versions = await db
    .select()
    .from(brandIdentityVersions)
    .where(eq(brandIdentityVersions.clientId, clientId))
    .orderBy(desc(brandIdentityVersions.number));
  const counts = await db
    .select({ status: brandIdentityProposals.status, n: sql<number>`count(*)::int` })
    .from(brandIdentityProposals)
    .where(eq(brandIdentityProposals.clientId, clientId))
    .groupBy(brandIdentityProposals.status);
  const sources = await db
    .select({ status: brandSources.status, n: sql<number>`count(*)::int` })
    .from(brandSources)
    .where(and(eq(brandSources.clientId, clientId), isNull(brandSources.removedAt)))
    .groupBy(brandSources.status);
  const draft = versions.find((v) => v.status === "draft" || v.status === "in_review") ?? null;
  const published = versions.find((v) => v.status === "published") ?? null;
  const proposalCounts = Object.fromEntries(counts.map((c) => [c.status, c.n])) as Partial<
    Record<"proposed" | "accepted" | "rejected" | "stale", number>
  >;
  const sourceCounts = Object.fromEntries(sources.map((c) => [c.status, c.n])) as Partial<
    Record<"pending" | "extracting" | "extracted" | "partial" | "failed", number>
  >;
  return { versions, draft, published, proposalCounts, sourceCounts };
}

export async function listProposals(
  db: Database,
  actor: Actor,
  clientId: string,
  filter: { status?: "proposed" | "accepted" | "rejected" | "stale" } = {},
) {
  assertCan(actor, "view", clientId);
  return db
    .select()
    .from(brandIdentityProposals)
    .where(
      and(
        eq(brandIdentityProposals.clientId, clientId),
        filter.status ? eq(brandIdentityProposals.status, filter.status) : undefined,
      ),
    )
    .orderBy(desc(brandIdentityProposals.createdAt))
    .limit(500);
}

export async function listSources(db: Database, actor: Actor, clientId: string) {
  assertCan(actor, "view", clientId);
  return db
    .select({
      id: brandSources.id,
      kind: brandSources.kind,
      title: brandSources.title,
      url: brandSources.url,
      storageKey: brandSources.storageKey,
      mime: brandSources.mime,
      size: brandSources.size,
      status: brandSources.status,
      statusDetail: brandSources.statusDetail,
      note: brandSources.note,
      capturedAt: brandSources.capturedAt,
      pageCount: sql<number>`coalesce(jsonb_array_length(${brandSources.pages}), 0)::int`,
    })
    .from(brandSources)
    .where(and(eq(brandSources.clientId, clientId), isNull(brandSources.removedAt)))
    .orderBy(desc(brandSources.capturedAt));
}
