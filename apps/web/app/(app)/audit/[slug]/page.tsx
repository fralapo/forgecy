import {
  estimateAudit,
  getAuditOverview,
  getProspectBySlug,
  reportReadiness,
} from "@forgecy/audit";
import { prospectObjectives, type ProspectObjective } from "@forgecy/core";
import { Badge, Button, Card, CardDescription, CardHeader, CardTitle } from "@forgecy/ui";
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  Check,
  CircleDashed,
  Play,
  UserCheck,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { env } from "@/lib/env";
import { getFormat } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import {
  archiveAuditAction,
  archiveProspectAction,
  convertToClientAction,
  restoreProspectAction,
  startAuditAction,
} from "../actions";
import { ActionButton } from "../_components/action-button";
import { DeleteProspect, PolicySelect } from "../_components/prospect-admin";
import { ProspectForm } from "../_components/prospect-form";
import { auditRefText } from "../_lib/findings";
import { sourceStatusVariant } from "../_lib/labels";
import { readinessDetail, readinessLabel } from "../_lib/readiness";
import { readDeps } from "../_lib/server";

const isObjective = (o: string): o is ProspectObjective =>
  (prospectObjectives as readonly string[]).includes(o);

export default async function ProspectOverviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const user = await requireUser();
  const { slug } = await params;
  const { db } = readDeps();
  const prospect = await getProspectBySlug(db, slug);
  if (!prospect) notFound();
  const { client, profile, audit } = prospect;
  const t = await getTranslations("audit");
  const format = await getFormat();
  const rt = await auditRefText();
  const usd = (value: number) =>
    format.number(value, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" });
  const activeAudit =
    audit && audit.status !== "archived" && audit.status !== "delivered" ? audit : null;

  // Converted to client: the audit stays readable as history, the prospect controls go away.
  if (client.status !== "prospect")
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("overview.converted.title")}</CardTitle>
          <CardDescription>
            {t("overview.converted.description", { name: client.name })}
          </CardDescription>
        </CardHeader>
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="primary">
            <Link href={`/audit/${slug}/report` as Route}>
              {t("overview.converted.openReport")}
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href={`/clients/${slug}` as Route}>{t("overview.converted.openClient")}</Link>
          </Button>
        </div>
      </Card>
    );

  const editForm = (
    <ProspectForm
      mode="edit"
      clientId={client.id}
      rev={profile?.rev ?? 1}
      initial={{
        name: client.name,
        websiteUrl: client.websiteUrl ?? "",
        sector: client.sector ?? "",
        area: profile?.area ?? "",
        objectives: (profile?.objectives ?? []) as ProspectObjective[],
        otherObjective: profile?.otherObjective ?? "",
        notes: client.notes ?? "",
        reportLanguage: profile?.reportLanguage === "it" ? "it" : "en",
        socialUrls: profile?.socialUrls ?? {},
      }}
    />
  );

  const side = (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("overview.prospect")}</CardTitle>
          <CardDescription>{t(`overview.policy.${client.aiPolicy}`)}</CardDescription>
        </CardHeader>
        <dl className="grid gap-2 text-body-sm">
          <div>
            <dt className="text-fg-muted">{t("overview.website")}</dt>
            <dd>{client.websiteUrl ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">{t("overview.sectorArea")}</dt>
            <dd>{[client.sector, profile?.area].filter(Boolean).join(" · ") || "—"}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">{t("overview.goals")}</dt>
            <dd>
              {(profile?.objectives ?? [])
                .map((o) => (isObjective(o) ? t(`objective.${o}`) : o))
                .concat(profile?.otherObjective ? [profile.otherObjective] : [])
                .join(", ") || "—"}
            </dd>
          </div>
        </dl>
        {user.isAdmin ? <PolicySelect clientId={client.id} policy={client.aiPolicy} /> : null}
        {audit?.status === "delivered" && !client.archivedAt ? (
          <ActionButton
            action={convertToClientAction.bind(null, client.id)}
            icon={<UserCheck aria-hidden />}
            variant="primary"
            confirm={t("overview.convertConfirm", { name: client.name })}
          >
            {t("overview.convert")}
          </ActionButton>
        ) : (
          <>
            <Button variant="secondary" disabled title={t("overview.deliverFirst")}>
              <UserCheck aria-hidden />
              {t("overview.convert")}
            </Button>
            <p className="text-body-sm text-fg-muted">{t("overview.convertAfterDelivery")}</p>
          </>
        )}
      </Card>
      <details className="rounded-lg border border-subtle bg-surface p-6">
        <summary className="cursor-pointer text-heading-sm text-fg">
          {t("overview.editDetails")}
        </summary>
        <div className="mt-4">{editForm}</div>
      </details>
      <details className="rounded-lg border border-subtle bg-surface p-6">
        <summary className="cursor-pointer text-heading-sm text-fg">
          {t("overview.archiveOrDelete")}
        </summary>
        <div className="mt-4 flex flex-col gap-4">
          {client.archivedAt ? (
            <ActionButton
              action={restoreProspectAction.bind(null, client.id)}
              icon={<ArchiveRestore aria-hidden />}
            >
              {t("overview.restore")}
            </ActionButton>
          ) : (
            <ActionButton
              action={archiveProspectAction.bind(null, client.id)}
              icon={<Archive aria-hidden />}
            >
              {t("overview.archive")}
            </ActionButton>
          )}
          <DeleteProspect clientId={client.id} name={client.name} />
        </div>
      </details>
    </div>
  );

  if (!activeAudit) {
    const estimate = await estimateAudit(db, client.id, env.AI_DEFAULT_PROVIDER);
    return (
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>{t("overview.start.title")}</CardTitle>
            <CardDescription>
              {audit
                ? t("overview.start.lastAudit", {
                    status: t(`status.${audit.status}`).toLowerCase(),
                  })
                : t("overview.start.intro")}
            </CardDescription>
          </CardHeader>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-body-md">
            {estimate.steps.map((s) => (
              <li key={s.id}>
                {"values" in s
                  ? t(`overview.start.steps.${s.id}`, s.values)
                  : t(`overview.start.steps.${s.id}`)}
              </li>
            ))}
          </ol>
          <dl className="grid gap-2 text-body-sm sm:grid-cols-2">
            <div>
              <dt className="text-fg-muted">{t("overview.start.cost")}</dt>
              <dd>
                {estimate.costRangeUsd
                  ? t("overview.start.costRange", {
                      min: usd(estimate.costRangeUsd.min),
                      max: usd(estimate.costRangeUsd.max),
                    })
                  : estimate.localModel
                    ? t("overview.start.noCostLocal")
                    : t("overview.start.noCostOff")}
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted">{t("overview.start.budgetLeft")}</dt>
              <dd>
                {estimate.budgetLeftUsd === null
                  ? t("overview.start.noLimit")
                  : usd(estimate.budgetLeftUsd)}
              </dd>
            </div>
          </dl>
          {estimate.budgetBlocked ? (
            <p role="alert" className="text-body-sm text-error">
              {t("overview.start.budgetBlocked")}
            </p>
          ) : null}
          <div>
            <ActionButton
              action={startAuditAction.bind(null, client.id)}
              icon={<Play aria-hidden />}
              variant="primary"
            >
              {t("overview.start.submit")}
            </ActionButton>
          </div>
        </Card>
        {side}
      </div>
    );
  }

  const [overview, readiness] = await Promise.all([
    getAuditOverview(db, activeAudit.id),
    reportReadiness(db, activeAudit.id),
  ]);
  const base = `/audit/${slug}`;
  const next: Array<{ href: string; label: string }> = [];
  if (overview.audit.status === "awaiting_competitors" && !overview.audit.competitorsConfirmedAt)
    next.push({ href: `${base}/competitors`, label: t("overview.next.confirmCompetitors") });
  if (overview.counts.observationsToReview)
    next.push({
      href: `${base}/website`,
      label: t("overview.next.review", { count: overview.counts.observationsToReview }),
    });
  if (overview.channels.some((c) => c.channel !== "website" && c.status === "pending"))
    next.push({ href: `${base}/social`, label: t("overview.next.addSocial") });
  if (overview.counts.observationsUsable && !overview.counts.problems)
    next.push({ href: `${base}/diagnosis`, label: t("overview.next.diagnosis") });

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-6">
        {next.length ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("overview.next.title")}</CardTitle>
            </CardHeader>
            <ul className="flex flex-col gap-2">
              {next.map((n) => (
                <li key={n.href + n.label}>
                  <Link
                    href={n.href as Route}
                    className="inline-flex items-center gap-2 text-body-md text-link underline-offset-2 hover:underline"
                  >
                    <ArrowRight aria-hidden className="size-4" />
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>{t("overview.sources.title")}</CardTitle>
            <CardDescription>
              {t("overview.sources.description", {
                date: overview.audit.startedAt
                  ? format.date(overview.audit.startedAt, "dateTime")
                  : "—",
              })}
            </CardDescription>
          </CardHeader>
          <ul className="flex flex-col divide-y divide-subtle">
            {overview.channels
              .sort((a, b) => (a.channel === "website" ? -1 : b.channel === "website" ? 1 : 0))
              .map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <span className="text-body-md text-fg">{t(`channel.${c.channel}`)}</span>
                  <span className="flex items-center gap-2">
                    {c.unavailableReason ? (
                      <span className="text-body-sm text-fg-muted">
                        {rt(c.unavailableRef, c.unavailableReason)}
                      </span>
                    ) : null}
                    <Badge variant={sourceStatusVariant[c.status]}>
                      {t(`sourceStatus.${c.status}`)}
                    </Badge>
                  </span>
                </li>
              ))}
            <li className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span className="text-body-md text-fg">{t("overview.sources.competitors")}</span>
              <span className="text-body-sm text-fg-muted">
                {overview.audit.competitorsSkipped
                  ? t("overview.sources.withoutCompetitors")
                  : overview.audit.competitorsConfirmedAt
                    ? t("overview.sources.confirmed", {
                        count: overview.competitors.filter((c) => c.status === "confirmed").length,
                      })
                    : t("overview.sources.proposed", {
                        count: overview.competitors.filter((c) => c.status === "proposed").length,
                      })}
              </span>
            </li>
          </ul>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("overview.beforeReport")}</CardTitle>
            <CardDescription>
              <Link
                href={`${base}/report` as Route}
                className="text-link underline-offset-2 hover:underline"
              >
                {t("overview.goToReport")}
              </Link>
            </CardDescription>
          </CardHeader>
          <ul className="flex flex-col gap-2">
            {readiness.map((r) => (
              <li key={r.key} className="flex items-start gap-2 text-body-sm">
                {r.ok ? (
                  <Check aria-hidden className="mt-0.5 size-4 text-success" />
                ) : (
                  <CircleDashed aria-hidden className="mt-0.5 size-4 text-fg-muted" />
                )}
                <span>
                  {readinessLabel(t, r)}
                  {r.detail ? (
                    <span className="text-fg-muted"> · {readinessDetail(t, r)}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <div>
          <ActionButton
            action={archiveAuditAction.bind(null, overview.audit.id)}
            icon={<Archive aria-hidden />}
            variant="ghost"
            confirm={t("overview.archiveAuditConfirm")}
          >
            {t("overview.archiveAudit")}
          </ActionButton>
        </div>
      </div>
      {side}
    </div>
  );
}
