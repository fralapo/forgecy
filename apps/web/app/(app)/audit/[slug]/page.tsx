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
import { requireUser } from "@/lib/session";
import {
  archiveAuditAction,
  archiveProspectAction,
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

const policyText = {
  external_allowed: "AI esterna ammessa",
  external_restricted: "AI esterna limitata ai provider approvati",
  local_only: "Solo AI locale",
  no_ai: "Nessuna AI: osservazioni e diagnosi si compilano a mano",
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
            <dt className="text-fg-muted">Sito</dt>
            <dd>{client.websiteUrl ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Settore e area</dt>
            <dd>{[client.sector, profile?.area].filter(Boolean).join(" · ") || "—"}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Obiettivi</dt>
            <dd>
              {(profile?.objectives ?? [])
                .map((o) => prospectObjectiveLabels[o as ProspectObjective] ?? o)
                .concat(profile?.otherObjective ? [profile.otherObjective] : [])
                .join(", ") || "—"}
            </dd>
          </div>
        </dl>
        {user.isAdmin ? <PolicySelect clientId={client.id} policy={client.aiPolicy} /> : null}
        <Button variant="secondary" disabled title="Consegna prima il report">
          <UserCheck aria-hidden />
          Converti in cliente
        </Button>
        <p className="text-body-sm text-fg-muted">Si attiva dopo la consegna del report.</p>
      </Card>
      <details className="rounded-lg border border-subtle bg-surface p-6">
        <summary className="cursor-pointer text-heading-sm text-fg">Modifica i dati</summary>
        <div className="mt-4">{editForm}</div>
      </details>
      <details className="rounded-lg border border-subtle bg-surface p-6">
        <summary className="cursor-pointer text-heading-sm text-fg">Archivia o elimina</summary>
        <div className="mt-4 flex flex-col gap-4">
          {client.archivedAt ? (
            <ActionButton
              action={restoreProspectAction.bind(null, client.id)}
              icon={<ArchiveRestore aria-hidden />}
            >
              Ripristina prospect
            </ActionButton>
          ) : (
            <ActionButton
              action={archiveProspectAction.bind(null, client.id)}
              icon={<Archive aria-hidden />}
            >
              Archivia prospect
            </ActionButton>
          )}
          <DeleteProspect clientId={client.id} name={client.name} />
        </div>
      </details>
    </div>
  );

  if (!activeAudit) {
    const estimate = await estimateAudit(db, client.id);
    return (
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>Avvia l&apos;audit</CardTitle>
            <CardDescription>
              {audit
                ? `L'ultimo audit è ${auditStatusLabel[audit.status].toLowerCase()}. Puoi avviarne uno nuovo.`
                : "Ecco cosa succede quando lo avvii. Puoi fermare ogni passo."}
            </CardDescription>
          </CardHeader>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-body-md">
            {estimate.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <dl className="grid gap-2 text-body-sm sm:grid-cols-2">
            <div>
              <dt className="text-fg-muted">Costo AI stimato</dt>
              <dd>
                {estimate.costRangeUsd
                  ? `${estimate.costRangeUsd.min.toFixed(2)}–${estimate.costRangeUsd.max.toFixed(2)} $ (prezzi API del provider)`
                  : "Nessun costo: AI disattivata"}
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted">Budget rimasto questo mese</dt>
              <dd>
                {estimate.budgetLeftUsd === null
                  ? "Nessun limite impostato"
                  : `${estimate.budgetLeftUsd.toFixed(2)} $`}
              </dd>
            </div>
          </dl>
          {estimate.budgetBlocked ? (
            <p role="alert" className="text-body-sm text-error">
              Il budget rimasto non basta per l&apos;audit. Un Admin può aumentarlo nelle
              impostazioni.
            </p>
          ) : null}
          <div>
            <ActionButton
              action={startAuditAction.bind(null, client.id)}
              icon={<Play aria-hidden />}
              variant="primary"
            >
              Avvia audit
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
    next.push({ href: `${base}/competitor`, label: "Conferma la lista dei competitor" });
  if (overview.counts.observationsToReview)
    next.push({
      href: `${base}/sito`,
      label: `Rivedi ${overview.counts.observationsToReview} osservazioni proposte`,
    });
  if (overview.channels.some((c) => c.channel !== "website" && c.status === "pending"))
    next.push({ href: `${base}/social`, label: "Aggiungi i dati dei social" });
  if (overview.counts.observationsUsable && !overview.counts.problems)
    next.push({ href: `${base}/diagnosi`, label: "Genera la diagnosi" });

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-6">
        {next.length ? (
          <Card>
            <CardHeader>
              <CardTitle>Prossimi passi</CardTitle>
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
            <CardTitle>Fonti</CardTitle>
            <CardDescription>
              Avviato il {formatDateTime(overview.audit.startedAt)}. I social non vengono letti in
              automatico: si caricano screenshot, export o valori.
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
              <span className="text-body-md text-fg">Competitor</span>
              <span className="text-body-sm text-fg-muted">
                {overview.audit.competitorsSkipped
                  ? "Audit senza competitor"
                  : overview.audit.competitorsConfirmedAt
                    ? `${overview.competitors.filter((c) => c.status === "confirmed").length} confermati`
                    : `${overview.competitors.filter((c) => c.status === "proposed").length} proposti, da confermare`}
              </span>
            </li>
          </ul>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Prima del report</CardTitle>
            <CardDescription>Il report si prepara nel prossimo modulo.</CardDescription>
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
            confirm="Archiviare questo audit? I dati restano consultabili e potrai avviarne uno nuovo."
          >
            Archivia audit
          </ActionButton>
        </div>
      </div>
      {side}
    </div>
  );
}
