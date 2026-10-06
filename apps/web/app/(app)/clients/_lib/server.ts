import "server-only";
import {
  and,
  assets,
  auditEvents,
  auditReports,
  audits,
  brandIdentityProposals,
  brandIdentityVersions,
  budgets,
  clients,
  contents,
  desc,
  eq,
  getDb,
  gte,
  inArray,
  isNull,
  jobsLog,
  or,
  products,
  sql,
  users,
} from "@forgecy/db";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { entitiesOf, periodStart, type ActivityFilters } from "./activity";

const countAll = sql<number>`count(*)::int`;

/** The client of a `/clients/[clientSlug]` page (archived ones included), or a 404. */
export async function loadClientPage(slug: string) {
  const user = await requireUser();
  const db = getDb();
  const [client] = await db.select().from(clients).where(eq(clients.slug, slug));
  if (!client) notFound();
  return { db, user, client };
}

type Db = ReturnType<typeof getDb>;
type SQL = ReturnType<typeof eq>;

/** Events of one client: those tagged with it, plus the ones about the client row itself. */
function clientEvents(clientId: string): SQL {
  return or(
    eq(auditEvents.clientId, clientId),
    and(eq(auditEvents.entity, "client"), eq(auditEvents.entityId, clientId)),
  ) as SQL;
}

export async function listClientActivity(
  db: Db,
  clientId: string,
  filters: Pick<ActivityFilters, "actorType" | "area" | "period" | "limit">,
) {
  const where: SQL[] = [clientEvents(clientId)];
  if (filters.actorType === "person") where.push(sql`${auditEvents.actor} like 'user:%'`);
  if (filters.actorType === "agent") where.push(sql`${auditEvents.actor} like 'agent:%'`);
  if (filters.actorType === "system") where.push(eq(auditEvents.actor, "system"));
  if (filters.area) where.push(inArray(auditEvents.entity, entitiesOf(filters.area)));
  if (filters.period) where.push(gte(auditEvents.at, periodStart(filters.period)));
  const cond = and(...where);
  const [rows, [total]] = await Promise.all([
    db
      .select({ e: auditEvents, userName: users.name })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(cond)
      .orderBy(desc(auditEvents.at), desc(auditEvents.id))
      .limit(filters.limit),
    db.select({ n: countAll }).from(auditEvents).where(cond),
  ]);
  return { rows, total: total?.n ?? 0 };
}

export type ActivityRow = Awaited<ReturnType<typeof listClientActivity>>["rows"][number];

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** Everything the client overview shows, read in parallel. */
export async function loadClientOverview(db: Db, clientId: string) {
  const month = monthStart(new Date());
  const [
    versions,
    [proposals],
    recentCarousels,
    reviewCarousels,
    [openCarousels],
    [aiImages],
    [proposedProducts],
    recentAudits,
    activity,
    [spend],
    [budget],
  ] = await Promise.all([
    db
      .select({
        number: brandIdentityVersions.number,
        status: brandIdentityVersions.status,
        publishedAt: brandIdentityVersions.publishedAt,
        publishedByName: users.name,
      })
      .from(brandIdentityVersions)
      .leftJoin(users, eq(users.id, brandIdentityVersions.publishedBy))
      .where(
        and(
          eq(brandIdentityVersions.clientId, clientId),
          inArray(brandIdentityVersions.status, ["draft", "in_review", "published"]),
        ),
      ),
    db
      .select({ n: countAll })
      .from(brandIdentityProposals)
      .where(
        and(
          eq(brandIdentityProposals.clientId, clientId),
          eq(brandIdentityProposals.status, "proposed"),
        ),
      ),
    db
      .select({
        id: contents.id,
        title: contents.title,
        status: contents.status,
        format: contents.format,
        updatedAt: contents.updatedAt,
        brandVersionNumber: brandIdentityVersions.number,
      })
      .from(contents)
      .leftJoin(brandIdentityVersions, eq(brandIdentityVersions.id, contents.brandVersionId))
      .where(and(eq(contents.clientId, clientId), isNull(contents.archivedAt)))
      .orderBy(desc(contents.updatedAt))
      .limit(6),
    db
      .select({ id: contents.id, title: contents.title })
      .from(contents)
      .where(
        and(
          eq(contents.clientId, clientId),
          eq(contents.status, "in_review"),
          isNull(contents.archivedAt),
        ),
      )
      .orderBy(contents.updatedAt)
      .limit(5),
    db
      .select({ n: countAll })
      .from(contents)
      .where(
        and(
          eq(contents.clientId, clientId),
          inArray(contents.status, ["draft", "in_review", "changes_requested"]),
          isNull(contents.archivedAt),
        ),
      ),
    db
      .select({ n: countAll })
      .from(assets)
      .where(
        and(eq(assets.clientId, clientId), eq(assets.source, "ai"), eq(assets.status, "draft")),
      ),
    db
      .select({ n: countAll })
      .from(products)
      .where(
        and(
          eq(products.clientId, clientId),
          eq(products.status, "proposed"),
          isNull(products.archivedAt),
        ),
      ),
    db
      .select({
        id: audits.id,
        status: audits.status,
        createdAt: audits.createdAt,
        ownerName: users.name,
      })
      .from(audits)
      .leftJoin(users, eq(users.id, audits.ownerId))
      .where(eq(audits.clientId, clientId))
      .orderBy(desc(audits.createdAt))
      .limit(3),
    listClientActivity(db, clientId, { actorType: null, area: null, period: null, limit: 10 }),
    db
      .select({ micro: sql<string>`coalesce(sum(${jobsLog.costMicroUsd}), 0)::text` })
      .from(jobsLog)
      .where(and(eq(jobsLog.clientId, clientId), gte(jobsLog.startedAt, month))),
    db
      .select({ limitCents: budgets.limitCents })
      .from(budgets)
      .where(
        and(
          eq(budgets.scope, "client"),
          eq(budgets.scopeId, clientId),
          eq(budgets.month, month.toISOString().slice(0, 10)),
        ),
      ),
  ]);

  const auditIds = recentAudits.map((a) => a.id);
  const reports = auditIds.length
    ? await db
        .select({ auditId: auditReports.auditId, status: auditReports.status })
        .from(auditReports)
        .where(inArray(auditReports.auditId, auditIds))
        .orderBy(desc(auditReports.version))
    : [];
  const latestReport = new Map<string, (typeof reports)[number]>();
  for (const r of reports) if (!latestReport.has(r.auditId)) latestReport.set(r.auditId, r);

  const published = versions.find((v) => v.status === "published") ?? null;
  const open = versions.find((v) => v.status === "draft" || v.status === "in_review") ?? null;
  const reportsInReview = [...latestReport.values()].filter((r) => r.status === "in_review").length;

  return {
    brand: { published, open, proposals: proposals?.n ?? 0 },
    carousels: { recent: recentCarousels, open: openCarousels?.n ?? 0 },
    waiting: {
      proposals: proposals?.n ?? 0,
      versionInReview: open?.status === "in_review" ? open.number : null,
      carousels: reviewCarousels,
      aiImages: aiImages?.n ?? 0,
      products: proposedProducts?.n ?? 0,
      reports: reportsInReview,
    },
    audits: recentAudits.map((a) => ({ ...a, report: latestReport.get(a.id) ?? null })),
    activity,
    spend: {
      usd: Number(spend?.micro ?? 0) / 1_000_000,
      limitUsd: budget ? budget.limitCents / 100 : null,
      month,
    },
  };
}

export type ClientOverview = Awaited<ReturnType<typeof loadClientOverview>>;
