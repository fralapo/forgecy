import "server-only";
import {
  and,
  assets,
  auditReports,
  audits,
  brandIdentityVersions,
  clients,
  contents,
  desc,
  eq,
  getDb,
  inArray,
  isNull,
  ne,
  or,
  products,
  sql,
  templates,
} from "@forgecy/db";
import {
  FULL_LIMIT,
  GROUP_LIMIT,
  likePattern,
  searchTypes,
  type SearchParams,
  type SearchType,
} from "./query";

type Db = ReturnType<typeof getDb>;
type Cond = ReturnType<typeof eq>;

export interface SearchHit {
  id: string;
  title: string;
  status: string;
  client: { name: string; slug: string } | null;
  /** SKU, format, version number... shown next to the title. */
  detail: string | null;
  href: string;
}

export interface SearchGroup {
  type: SearchType;
  total: number;
  hits: SearchHit[];
}

const countAll = sql<number>`count(*)::int`;
const ilike = (col: unknown, pattern: string) => sql`${col} ilike ${pattern}` as Cond;
const all = (conds: Array<Cond | undefined>) => and(...conds.filter(Boolean)) as Cond;

/** Conditions shared by every type that belongs to a client. */
function clientScope(p: SearchParams): Array<Cond | undefined> {
  return [
    p.client ? eq(clients.slug, p.client) : undefined,
    p.archived ? undefined : isNull(clients.archivedAt),
  ];
}

async function searchType(
  db: Db,
  type: SearchType,
  p: SearchParams,
  limit: number,
): Promise<SearchGroup> {
  const pat = likePattern(p.q);
  const owner = { name: clients.name, slug: clients.slug };
  switch (type) {
    case "client": {
      const where = all([
        or(ilike(clients.name, pat), ilike(clients.slug, pat), ilike(clients.websiteUrl, pat)),
        ...clientScope(p),
      ]);
      const [rows, [n]] = await Promise.all([
        db
          .select({
            id: clients.id,
            name: clients.name,
            slug: clients.slug,
            status: clients.status,
            archivedAt: clients.archivedAt,
            sector: clients.sector,
          })
          .from(clients)
          .where(where)
          .orderBy(clients.name)
          .limit(limit),
        db.select({ n: countAll }).from(clients).where(where),
      ]);
      return {
        type,
        total: n?.n ?? 0,
        hits: rows.map((r) => ({
          id: r.id,
          title: r.name,
          status: r.archivedAt ? "archived" : r.status,
          client: null,
          detail: r.sector,
          href: `/clients/${r.slug}`,
        })),
      };
    }
    case "carousel": {
      const where = all([
        ilike(contents.title, pat),
        p.archived ? undefined : isNull(contents.archivedAt),
        ...clientScope(p),
      ]);
      const [rows, [n]] = await Promise.all([
        db
          .select({
            id: contents.id,
            title: contents.title,
            status: contents.status,
            format: contents.format,
            owner,
          })
          .from(contents)
          .innerJoin(clients, eq(clients.id, contents.clientId))
          .where(where)
          .orderBy(desc(contents.updatedAt))
          .limit(limit),
        db
          .select({ n: countAll })
          .from(contents)
          .innerJoin(clients, eq(clients.id, contents.clientId))
          .where(where),
      ]);
      return {
        type,
        total: n?.n ?? 0,
        hits: rows.map((r) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          client: r.owner,
          detail: r.format,
          href: `/content/${r.owner.slug}/carousels/${r.id}`,
        })),
      };
    }
    case "product": {
      const where = all([
        or(
          ilike(products.name, pat),
          ilike(products.sku, pat),
          ilike(products.category, pat),
          ilike(sql`array_to_string(${products.tags}, ' ')`, pat),
        ),
        p.archived ? undefined : isNull(products.archivedAt),
        ...clientScope(p),
      ]);
      const [rows, [n]] = await Promise.all([
        db
          .select({
            id: products.id,
            name: products.name,
            sku: products.sku,
            status: products.status,
            owner,
          })
          .from(products)
          .innerJoin(clients, eq(clients.id, products.clientId))
          .where(where)
          .orderBy(desc(products.updatedAt))
          .limit(limit),
        db
          .select({ n: countAll })
          .from(products)
          .innerJoin(clients, eq(clients.id, products.clientId))
          .where(where),
      ]);
      return {
        type,
        total: n?.n ?? 0,
        hits: rows.map((r) => ({
          id: r.id,
          title: r.name,
          status: r.status,
          client: r.owner,
          detail: r.sku,
          href: `/products/${r.owner.slug}/${r.id}`,
        })),
      };
    }
    case "brand": {
      const where = all([
        ilike(clients.name, pat),
        p.archived
          ? undefined
          : inArray(brandIdentityVersions.status, ["draft", "in_review", "published"]),
        ...clientScope(p),
      ]);
      const [rows, [n]] = await Promise.all([
        db
          .select({
            id: brandIdentityVersions.id,
            number: brandIdentityVersions.number,
            status: brandIdentityVersions.status,
            owner,
          })
          .from(brandIdentityVersions)
          .innerJoin(clients, eq(clients.id, brandIdentityVersions.clientId))
          .where(where)
          .orderBy(clients.name, desc(brandIdentityVersions.number))
          .limit(limit),
        db
          .select({ n: countAll })
          .from(brandIdentityVersions)
          .innerJoin(clients, eq(clients.id, brandIdentityVersions.clientId))
          .where(where),
      ]);
      return {
        type,
        total: n?.n ?? 0,
        hits: rows.map((r) => ({
          id: r.id,
          title: r.owner.name,
          status: r.status,
          client: null,
          detail: `v${r.number}`,
          href: `/brand/${r.owner.slug}`,
        })),
      };
    }
    case "audit": {
      const where = all([
        ilike(clients.name, pat),
        p.archived ? undefined : ne(audits.status, "archived"),
        ...clientScope(p),
      ]);
      const [rows, [n]] = await Promise.all([
        db
          .select({ id: audits.id, status: audits.status, owner })
          .from(audits)
          .innerJoin(clients, eq(clients.id, audits.clientId))
          .where(where)
          .orderBy(desc(audits.createdAt))
          .limit(limit),
        db
          .select({ n: countAll })
          .from(audits)
          .innerJoin(clients, eq(clients.id, audits.clientId))
          .where(where),
      ]);
      return {
        type,
        total: n?.n ?? 0,
        hits: rows.map((r) => ({
          id: r.id,
          title: r.owner.name,
          status: r.status,
          client: null,
          detail: null,
          href: `/audit/${r.owner.slug}`,
        })),
      };
    }
    case "report": {
      const where = all([
        ilike(clients.name, pat),
        p.archived ? undefined : ne(auditReports.status, "superseded"),
        ...clientScope(p),
      ]);
      const [rows, [n]] = await Promise.all([
        db
          .select({
            id: auditReports.id,
            version: auditReports.version,
            status: auditReports.status,
            owner,
          })
          .from(auditReports)
          .innerJoin(audits, eq(audits.id, auditReports.auditId))
          .innerJoin(clients, eq(clients.id, audits.clientId))
          .where(where)
          .orderBy(desc(auditReports.updatedAt))
          .limit(limit),
        db
          .select({ n: countAll })
          .from(auditReports)
          .innerJoin(audits, eq(audits.id, auditReports.auditId))
          .innerJoin(clients, eq(clients.id, audits.clientId))
          .where(where),
      ]);
      return {
        type,
        total: n?.n ?? 0,
        hits: rows.map((r) => ({
          id: r.id,
          title: r.owner.name,
          status: r.status,
          client: null,
          detail: `v${r.version}`,
          href: `/audit/${r.owner.slug}/report`,
        })),
      };
    }
    case "template": {
      // Agency templates have no client: a client filter keeps only that client's ones.
      const where = all([
        or(ilike(templates.name, pat), ilike(templates.key, pat)),
        p.archived ? undefined : ne(templates.status, "archived"),
        p.client ? eq(clients.slug, p.client) : undefined,
      ]);
      const [rows, [n]] = await Promise.all([
        db
          .select({
            id: templates.id,
            name: templates.name,
            version: templates.version,
            status: templates.status,
            format: templates.format,
            clientName: clients.name,
            clientSlug: clients.slug,
          })
          .from(templates)
          .leftJoin(clients, eq(clients.id, templates.clientId))
          .where(where)
          .orderBy(templates.name, desc(templates.createdAt))
          .limit(limit),
        db
          .select({ n: countAll })
          .from(templates)
          .leftJoin(clients, eq(clients.id, templates.clientId))
          .where(where),
      ]);
      return {
        type,
        total: n?.n ?? 0,
        hits: rows.map((r) => ({
          id: r.id,
          title: r.name,
          status: r.status,
          client: r.clientName && r.clientSlug ? { name: r.clientName, slug: r.clientSlug } : null,
          detail: `${r.format} · ${r.version}`,
          href: `/templates/${r.id}`,
        })),
      };
    }
    case "asset": {
      const where = all([
        or(ilike(assets.alt, pat), ilike(sql`array_to_string(${assets.tags}, ' ')`, pat)),
        p.archived ? undefined : ne(assets.status, "rejected"),
        ...clientScope(p),
      ]);
      const [rows, [n]] = await Promise.all([
        db
          .select({ id: assets.id, alt: assets.alt, status: assets.status, owner })
          .from(assets)
          .innerJoin(clients, eq(clients.id, assets.clientId))
          .where(where)
          .orderBy(desc(assets.createdAt))
          .limit(limit),
        db
          .select({ n: countAll })
          .from(assets)
          .innerJoin(clients, eq(clients.id, assets.clientId))
          .where(where),
      ]);
      return {
        type,
        total: n?.n ?? 0,
        hits: rows.map((r) => ({
          id: r.id,
          title: r.alt,
          status: r.status,
          client: r.owner,
          detail: null,
          href: `/content/${r.owner.slug}/library`,
        })),
      };
    }
  }
}

/**
 * Searches every type (for the counts) and returns the groups to show: all of
 * them with a few hits each, or the selected types with up to FULL_LIMIT hits.
 */
export async function runSearch(p: SearchParams) {
  const db = getDb();
  const selected = p.types.length ? p.types : searchTypes;
  const limit = p.types.length === 1 ? FULL_LIMIT : GROUP_LIMIT;
  const groups = await Promise.all(
    searchTypes.map((t) => searchType(db, t, p, selected.includes(t) ? limit : 0)),
  );
  const counts = Object.fromEntries(groups.map((g) => [g.type, g.total])) as Record<
    SearchType,
    number
  >;
  return {
    counts,
    groups: groups.filter((g) => selected.includes(g.type) && g.total > 0),
  };
}

/** Every client, for the client filter. */
export async function clientOptions() {
  return getDb()
    .select({ name: clients.name, slug: clients.slug })
    .from(clients)
    .orderBy(clients.name);
}
