import type { AuditStatus, ContentStatus, ReportStatus } from "@forgecy/core";
import { Badge, Button, Card, type BadgeProps } from "@forgecy/ui";
import { ArrowRight, Plus } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { getFormat } from "@/lib/i18n";
import { PolicySelect } from "../../audit/_components/prospect-admin";
import { statusVariant } from "../../content/[clientSlug]/carousels/_lib/labels";
import { ActivityList } from "../_components/activity-list";
import { loadClientOverview, loadClientPage, type ClientOverview } from "../_lib/server";

export async function generateMetadata({ params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params;
  const { client } = await loadClientPage(clientSlug);
  return { title: client.name };
}

const linkClass = "text-link underline-offset-2 hover:underline";

const reportVariant: Record<ReportStatus, NonNullable<BadgeProps["variant"]>> = {
  draft: "neutral",
  in_review: "warning",
  approved: "success",
  exported: "success",
  superseded: "neutral",
};

const auditVariant = (s: AuditStatus): NonNullable<BadgeProps["variant"]> =>
  s === "delivered" || s === "reviewed"
    ? "success"
    : s === "failed"
      ? "error"
      : s === "in_review" || s === "awaiting_competitors"
        ? "warning"
        : "neutral";

type NextAction = { text: string; cta?: { label: string; href: string } };

/** The one thing to do next on this client, in order of urgency. */
function nextAction(
  t: Awaited<ReturnType<typeof getTranslations<"clients.overview">>>,
  slug: string,
  status: string,
  o: ClientOverview,
): NextAction {
  const { waiting, brand, audits, carousels } = o;
  if (waiting.versionInReview !== null)
    return {
      text: t("next.approveVersion", { number: waiting.versionInReview }),
      cta: {
        label: t("next.openApproval"),
        href: `/brand/${slug}/versions/${waiting.versionInReview}/approve`,
      },
    };
  const carousel = waiting.carousels[0];
  if (carousel)
    return {
      text: t("next.approveCarousel", { title: carousel.title }),
      cta: {
        label: t("next.openApproval"),
        href: `/content/${slug}/carousels/${carousel.id}/review`,
      },
    };
  if (!brand.published && brand.proposals > 0)
    return {
      text: t("next.reviewProposals", { count: brand.proposals }),
      cta: { label: t("next.reviewProposalsCta"), href: `/brand/${slug}/proposals` },
    };
  const activeAudit = audits.find((a) => a.status !== "delivered" && a.status !== "archived");
  if (status === "prospect" && activeAudit)
    return {
      text: t("next.continueAudit"),
      cta: { label: t("next.openAudit"), href: `/audit/${slug}` },
    };
  if (status === "active" && brand.published && carousels.open === 0)
    return {
      text: t("next.createCarousel"),
      cta: { label: t("newCarousel"), href: `/content/${slug}/carousels/new` },
    };
  return { text: t("next.none") };
}

function Section({ id, title, children }: { id: string; title: ReactNode; children: ReactNode }) {
  return (
    <Card aria-labelledby={id} role="region">
      <h2 id={id} className="text-heading-sm text-fg">
        {title}
      </h2>
      {children}
    </Card>
  );
}

export default async function ClientOverviewPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const { db, user, client } = await loadClientPage(clientSlug);
  const [t, te, ta, tb, tc, tt, format, o] = await Promise.all([
    getTranslations("clients.overview"),
    getTranslations("enums"),
    getTranslations("audit"),
    getTranslations("brand"),
    getTranslations("content.labels"),
    getTranslations("templates"),
    getFormat(),
    loadClientOverview(db, client.id),
  ]);
  const slug = client.slug;
  const archived = client.status === "archived" || client.archivedAt !== null;
  const next = archived ? null : nextAction(t, slug, client.status, o);
  const canCreateCarousel = !archived && client.status === "active" && o.brand.published !== null;
  const formatLabel = (f: string) =>
    tt.has(`format.${f}` as never) ? tt(`format.${f}` as never) : f;
  const money = (usd: number) =>
    format.number(usd, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" });
  const { waiting } = o;
  const waitingItems: Array<{ key: string; text: string; href: string }> = [
    ...(waiting.versionInReview !== null
      ? [
          {
            key: "version",
            text: t("waiting.version", { number: waiting.versionInReview }),
            href: `/brand/${slug}/versions/${waiting.versionInReview}/approve`,
          },
        ]
      : []),
    ...(waiting.proposals > 0
      ? [
          {
            key: "proposals",
            text: t("waiting.proposals", { count: waiting.proposals }),
            href: `/brand/${slug}/proposals`,
          },
        ]
      : []),
    ...waiting.carousels.map((c) => ({
      key: `carousel-${c.id}`,
      text: t("waiting.carousel", { title: c.title }),
      href: `/content/${slug}/carousels/${c.id}/review`,
    })),
    ...(waiting.aiImages > 0
      ? [
          {
            key: "images",
            text: t("waiting.aiImages", { count: waiting.aiImages }),
            href: `/content/${slug}/library`,
          },
        ]
      : []),
    ...(waiting.products > 0
      ? [
          {
            key: "products",
            text: t("waiting.products", { count: waiting.products }),
            href: `/products/${slug}`,
          },
        ]
      : []),
    ...(waiting.reports > 0
      ? [
          {
            key: "reports",
            text: t("waiting.reports", { count: waiting.reports }),
            href: `/audit/${slug}/report`,
          },
        ]
      : []),
  ];
  const spendShare = o.spend.limitUsd ? o.spend.usd / o.spend.limitUsd : null;

  return (
    <>
      <Link href="/clients" className={`mb-4 inline-block text-body-sm ${linkClass}`}>
        {t("back")}
      </Link>
      <PageHeader
        title={client.name}
        description={[client.sector, client.websiteUrl].filter(Boolean).join(" · ") || undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={archived ? "neutral" : "success"}>
              {te(`clientStatus.${archived ? "archived" : client.status}`)}
            </Badge>
            <Badge variant="info">{te(`aiPolicy.${client.aiPolicy}`)}</Badge>
          </div>
        }
      />

      {archived ? (
        <p
          role="status"
          className="mb-6 rounded-md border border-subtle bg-surface p-4 text-body-md"
        >
          {client.archivedAt
            ? t("archivedOn", { date: format.date(client.archivedAt) })
            : t("archived")}
        </p>
      ) : null}

      {next ? (
        <Card className="mb-6 flex-row flex-wrap items-center justify-between gap-4">
          <p className="text-body-md text-fg">
            <span className="mr-2 text-label text-fg-muted">{t("next.label")}</span>
            {next.text}
          </p>
          {next.cta ? (
            <Button asChild>
              <Link href={next.cta.href as Route}>
                {next.cta.label}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          ) : canCreateCarousel ? (
            <Button asChild>
              <Link href={`/content/${slug}/carousels/new` as Route}>
                <Plus aria-hidden />
                {t("newCarousel")}
              </Link>
            </Button>
          ) : null}
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Section id="brand" title={t("brand.title")}>
          {o.brand.published ? (
            <div className="space-y-1">
              <Badge variant="success">
                {t("brand.published", { number: o.brand.published.number })}
              </Badge>
              {o.brand.published.publishedAt ? (
                <p className="text-body-sm text-fg-muted">
                  {o.brand.published.publishedByName
                    ? t("brand.publishedBy", {
                        date: format.date(o.brand.published.publishedAt),
                        name: o.brand.published.publishedByName,
                      })
                    : format.date(o.brand.published.publishedAt)}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-body-sm text-fg-muted">{t("brand.none")}</p>
          )}
          {o.brand.open ? (
            <p className="text-body-sm text-fg">
              {t("brand.open", {
                number: o.brand.open.number,
                status: tb(`versionStatus.${o.brand.open.status}`),
              })}
            </p>
          ) : null}
          {o.brand.proposals > 0 ? (
            <Badge variant="highlight">{t("brand.proposals", { count: o.brand.proposals })}</Badge>
          ) : null}
          <Link href={`/brand/${slug}` as Route} className={`text-body-sm ${linkClass}`}>
            {t("brand.openLink")}
          </Link>
        </Section>

        <Section id="policy" title={t("policy.title")}>
          {user.isAdmin && !archived ? (
            <>
              <p className="text-body-sm text-fg-muted">{t(`policy.explain.${client.aiPolicy}`)}</p>
              <PolicySelect clientId={client.id} policy={client.aiPolicy} />
            </>
          ) : (
            <>
              <p className="text-body-md text-fg">{te(`aiPolicy.${client.aiPolicy}`)}</p>
              <p className="text-body-sm text-fg-muted">{t(`policy.explain.${client.aiPolicy}`)}</p>
              <p className="text-body-sm text-fg-muted">{t("policy.adminOnly")}</p>
            </>
          )}
        </Section>

        <Section id="budget" title={t("budget.title")}>
          <p className="text-body-sm text-fg-muted">
            {t("budget.month", { month: format.date(o.spend.month, "month") })}
          </p>
          {o.spend.limitUsd !== null && spendShare !== null ? (
            <>
              <p className="text-body-md text-fg">
                {t("budget.ofLimit", {
                  percent: format.percent(spendShare),
                  spent: money(o.spend.usd),
                  limit: money(o.spend.limitUsd),
                })}
              </p>
              <div
                role="meter"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(Math.min(1, spendShare) * 100)}
                aria-label={t("budget.title")}
                className="h-2 w-full overflow-hidden rounded-full bg-app"
              >
                <div
                  className={
                    spendShare >= 1
                      ? "h-full bg-danger"
                      : spendShare >= 0.7
                        ? "h-full bg-warning-fill"
                        : "h-full bg-primary"
                  }
                  style={{ width: `${Math.min(100, Math.round(spendShare * 100))}%` }}
                />
              </div>
              {spendShare >= 1 ? (
                <p role="alert" className="text-body-sm text-error">
                  {t("budget.exhausted", { client: client.name })}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-body-md text-fg">
              {t("budget.noLimit", { spent: money(o.spend.usd) })}
            </p>
          )}
        </Section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Section
            id="carousels"
            title={
              <Link href={`/content/${slug}/carousels` as Route} className="hover:underline">
                {t("carousels.title")}
              </Link>
            }
          >
            {o.carousels.recent.length === 0 ? (
              <p className="text-body-sm text-fg-muted">
                {o.brand.published ? t("carousels.empty") : t("carousels.emptyNoBrand")}
              </p>
            ) : (
              <ul className="divide-y divide-subtle">
                {o.carousels.recent.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <Link
                      href={`/content/${slug}/carousels/${c.id}` as Route}
                      className={`text-body-md ${linkClass}`}
                    >
                      {c.title}
                    </Link>
                    <Badge variant={statusVariant[c.status as ContentStatus]}>
                      {tc(`contentStatus.${c.status as ContentStatus}`)}
                    </Badge>
                    <span className="text-body-sm text-fg-muted">{formatLabel(c.format)}</span>
                    {c.brandVersionNumber !== null ? (
                      <span className="text-body-sm text-fg-muted">
                        {o.brand.published && o.brand.published.number !== c.brandVersionNumber
                          ? t("carousels.brandOld", {
                              number: c.brandVersionNumber,
                              current: o.brand.published.number,
                            })
                          : t("carousels.brand", { number: c.brandVersionNumber })}
                      </span>
                    ) : null}
                    <span className="text-body-sm text-fg-muted">{format.date(c.updatedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            {canCreateCarousel ? (
              <Link
                href={`/content/${slug}/carousels/new` as Route}
                className={`text-body-sm ${linkClass}`}
              >
                {t("newCarousel")}
              </Link>
            ) : !archived && client.status === "active" && o.carousels.recent.length > 0 ? (
              <p className="text-body-sm text-fg-muted">{t("newCarouselBlocked")}</p>
            ) : null}
          </Section>
        </div>

        <Section id="waiting" title={t("waiting.title")}>
          {waitingItems.length === 0 ? (
            <p className="text-body-sm text-fg-muted">
              {t("waiting.empty", { client: client.name })}
            </p>
          ) : (
            <ul className="space-y-2">
              {waitingItems.map((w) => (
                <li key={w.key}>
                  <Link href={w.href as Route} className={`text-body-sm ${linkClass}`}>
                    {w.text}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Section
          id="audits"
          title={
            <Link href={`/audit/${slug}` as Route} className="hover:underline">
              {t("audits.title")}
            </Link>
          }
        >
          {o.audits.length === 0 ? (
            <p className="text-body-sm text-fg-muted">{t("audits.empty")}</p>
          ) : (
            <ul className="divide-y divide-subtle">
              {o.audits.map((a) => (
                <li key={a.id} className="space-y-1 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={auditVariant(a.status)}>{ta(`status.${a.status}`)}</Badge>
                    <span className="text-body-sm text-fg-muted">
                      {a.ownerName
                        ? t("audits.startedBy", {
                            date: format.date(a.createdAt),
                            name: a.ownerName,
                          })
                        : format.date(a.createdAt)}
                    </span>
                  </div>
                  {a.report ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={reportVariant[a.report.status]}>
                        {ta(`reportStatus.${a.report.status}`)}
                      </Badge>
                      <Link
                        href={`/audit/${slug}/report` as Route}
                        className={`text-body-sm ${linkClass}`}
                      >
                        {t("audits.openReport")}
                      </Link>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="lg:col-span-2">
          <Section
            id="activity"
            title={
              <Link href={`/clients/${slug}/activity` as Route} className="hover:underline">
                {t("activity.title")}
              </Link>
            }
          >
            {o.activity.rows.length === 0 ? (
              <p className="text-body-sm text-fg-muted">{t("activity.empty")}</p>
            ) : (
              <ActivityList rows={o.activity.rows} clientSlug={slug} />
            )}
            <Link
              href={`/clients/${slug}/activity` as Route}
              className={`text-body-sm ${linkClass}`}
            >
              {t("activity.all")}
            </Link>
          </Section>
        </div>
      </div>
    </>
  );
}
