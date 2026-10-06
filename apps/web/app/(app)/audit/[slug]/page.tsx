import {
  estimateAudit,
  getAuditOverview,
  getProspectBySlug,
  reportReadiness,
} from "@forgecy/audit";
import { prospectObjectiveLabels, type ProspectObjective } from "@forgecy/core";
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
import { env } from "@/lib/env";
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
import {
  auditStatusLabel,
  channelLabel,
  formatDateTime,
  sourceStatusLabel,
  sourceStatusVariant,
} from "../_lib/labels";
import { readDeps } from "../_lib/server";
import { plural } from "@/lib/plural";

const policyText = {
  external_allowed: "External AI allowed",
  external_restricted: "External AI restricted to approved providers",
  local_only: "Local AI only",
  no_ai: "No AI: observations and diagnosis are filled in by hand",
} as const;

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
  const activeAudit =
    audit && audit.status !== "archived" && audit.status !== "delivered" ? audit : null;

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
        reportLanguage: profile?.reportLanguage === "en" ? "en" : "it",
        socialUrls: profile?.socialUrls ?? {},
      }}
    />
  );

  const side = (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Prospect</CardTitle>
          <CardDescription>{policyText[client.aiPolicy]}</CardDescription>
        </CardHeader>
        <dl className="grid gap-2 text-body-sm">
          <div>
            <dt className="text-fg-muted">Website</dt>
            <dd>{client.websiteUrl ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Sector and area</dt>
            <dd>{[client.sector, profile?.area].filter(Boolean).join(" · ") || "—"}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Goals</dt>
            <dd>
              {(profile?.objectives ?? [])
                .map((o) => prospectObjectiveLabels[o as ProspectObjective] ?? o)
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
            confirm={`${client.name} becomes an active client. The audit, sources and accepted observations stay linked. No proposal becomes official without a person's approval.`}
          >
            Convert to client
          </ActionButton>
        ) : (
          <>
            <Button variant="secondary" disabled title="Deliver the report first">
              <UserCheck aria-hidden />
              Convert to client
            </Button>
            <p className="text-body-sm text-fg-muted">Available after the report is delivered.</p>
          </>
        )}
      </Card>
      <details className="rounded-lg border border-subtle bg-surface p-6">
        <summary className="cursor-pointer text-heading-sm text-fg">Edit details</summary>
        <div className="mt-4">{editForm}</div>
      </details>
      <details className="rounded-lg border border-subtle bg-surface p-6">
        <summary className="cursor-pointer text-heading-sm text-fg">Archive or delete</summary>
        <div className="mt-4 flex flex-col gap-4">
          {client.archivedAt ? (
            <ActionButton
              action={restoreProspectAction.bind(null, client.id)}
              icon={<ArchiveRestore aria-hidden />}
            >
              Restore prospect
            </ActionButton>
          ) : (
            <ActionButton
              action={archiveProspectAction.bind(null, client.id)}
              icon={<Archive aria-hidden />}
            >
              Archive prospect
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
            <CardTitle>Start the audit</CardTitle>
            <CardDescription>
              {audit
                ? `The last audit is ${auditStatusLabel[audit.status].toLowerCase()}. You can start a new one.`
                : "Here is what happens when you start it. You can stop every step."}
            </CardDescription>
          </CardHeader>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-body-md">
            {estimate.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <dl className="grid gap-2 text-body-sm sm:grid-cols-2">
            <div>
              <dt className="text-fg-muted">Estimated AI cost</dt>
              <dd>
                {estimate.costRangeUsd
                  ? `$${estimate.costRangeUsd.min.toFixed(2)}–${estimate.costRangeUsd.max.toFixed(2)} (provider API prices)`
                  : estimate.localModel
                    ? "No cost: local model"
                    : "No cost: AI turned off"}
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted">Budget left this month</dt>
              <dd>
                {estimate.budgetLeftUsd === null
                  ? "No limit set"
                  : `$${estimate.budgetLeftUsd.toFixed(2)}`}
              </dd>
            </div>
          </dl>
          {estimate.budgetBlocked ? (
            <p role="alert" className="text-body-sm text-error">
              The remaining budget is not enough for the audit. An Admin can raise it in the
              settings.
            </p>
          ) : null}
          <div>
            <ActionButton
              action={startAuditAction.bind(null, client.id)}
              icon={<Play aria-hidden />}
              variant="primary"
            >
              Start audit
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
    next.push({ href: `${base}/competitors`, label: "Confirm the competitor list" });
  if (overview.counts.observationsToReview)
    next.push({
      href: `${base}/website`,
      label: `Review ${plural(overview.counts.observationsToReview, "proposed observation", "proposed observations")}`,
    });
  if (overview.channels.some((c) => c.channel !== "website" && c.status === "pending"))
    next.push({ href: `${base}/social`, label: "Add the social data" });
  if (overview.counts.observationsUsable && !overview.counts.problems)
    next.push({ href: `${base}/diagnosis`, label: "Generate the diagnosis" });

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-6">
        {next.length ? (
          <Card>
            <CardHeader>
              <CardTitle>Next steps</CardTitle>
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
            <CardTitle>Sources</CardTitle>
            <CardDescription>
              Started on {formatDateTime(overview.audit.startedAt)}. Social channels are not read
              automatically: you upload screenshots, exports or values.
            </CardDescription>
          </CardHeader>
          <ul className="flex flex-col divide-y divide-subtle">
            {overview.channels
              .sort((a, b) => (a.channel === "website" ? -1 : b.channel === "website" ? 1 : 0))
              .map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <span className="text-body-md text-fg">{channelLabel[c.channel]}</span>
                  <span className="flex items-center gap-2">
                    {c.unavailableReason ? (
                      <span className="text-body-sm text-fg-muted">{c.unavailableReason}</span>
                    ) : null}
                    <Badge variant={sourceStatusVariant[c.status]}>
                      {sourceStatusLabel[c.status]}
                    </Badge>
                  </span>
                </li>
              ))}
            <li className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span className="text-body-md text-fg">Competitors</span>
              <span className="text-body-sm text-fg-muted">
                {overview.audit.competitorsSkipped
                  ? "Audit without competitors"
                  : overview.audit.competitorsConfirmedAt
                    ? `${overview.competitors.filter((c) => c.status === "confirmed").length} confirmed`
                    : `${overview.competitors.filter((c) => c.status === "proposed").length} proposed, to confirm`}
              </span>
            </li>
          </ul>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Before the report</CardTitle>
            <CardDescription>
              <Link
                href={`${base}/report` as Route}
                className="text-link underline-offset-2 hover:underline"
              >
                Go to the report
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
                  {r.label}
                  {r.detail ? <span className="text-fg-muted"> · {r.detail}</span> : null}
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
            confirm="Archive this audit? The data stays available and you can start a new one."
          >
            Archive audit
          </ActionButton>
        </div>
      </div>
      {side}
    </div>
  );
}
