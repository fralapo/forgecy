import { getSocialView, metricSourceLabels } from "@forgecy/audit";
import { SOCIAL_AREAS, socialChannels, type FindingArea, type SocialChannel } from "@forgecy/core";
import { Badge, Card, CardDescription, CardHeader, CardTitle, cn } from "@forgecy/ui";
import { Sparkles, Trash2 } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { deleteMetricAction, removeSourceAction, requestSocialAnalysisAction } from "../../actions";
import { ActionButton } from "../../_components/action-button";
import { AddFinding } from "../../_components/add-finding";
import { FindingCard } from "../../_components/finding-card";
import {
  ChannelSettings,
  MetricForm,
  ScreenshotUpload,
  TableImport,
} from "../../_components/social-tools";
import { sectionContext, sourceLinks, toView } from "../../_lib/findings";
import {
  channelLabel,
  formatDate,
  metricLabel,
  sourceStatusLabel,
  sourceStatusVariant,
} from "../../_lib/labels";
import { fileUrl } from "../../_lib/server";

export const metadata = { title: "Audit · Social" };

export default async function SocialPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ canale?: string }>;
}) {
  const { slug } = await params;
  const { canale } = await searchParams;
  const { db, audit, readOnly, aiAllowed } = await sectionContext(slug);
  const views = await Promise.all(socialChannels.map((c) => getSocialView(db, audit.id, c)));
  const withProfile = views.filter((v) => v.state);
  const channel: SocialChannel =
    socialChannels.find((c) => c === canale) ?? withProfile[0]?.channel ?? "instagram";
  const view = views.find((v) => v.channel === channel)!;
  const [links, shots, files] = await Promise.all([
    sourceLinks(db, view.findings),
    Promise.all(view.screenshots.map(async (s) => ({ ...s, href: await fileUrl(s.storageKey) }))),
    Promise.all(
      view.files.map(async (s) => ({
        ...s,
        href: await fileUrl(s.storageKey, s.fileName ?? "export"),
      })),
    ),
  ]);
  const pendingFile = view.files.find((f) => f.status === "pending");
  const hasData = view.postsCount > 0 || view.metrics.length > 0;
  const areas = (SOCIAL_AREAS as FindingArea[]).filter(
    (a) => a !== "linkedin_leads" || channel === "linkedin",
  );

  return (
    <div className="flex flex-col gap-8">
      <p className="text-body-md text-fg-muted">
        Forgecy non legge i social in automatico. Carica screenshot come prova, importa gli export o
        inserisci i valori a mano con la loro fonte. Un valore mancante resta “Non disponibile”, mai
        stimato.
      </p>
      <nav aria-label="Canali social">
        <ul className="flex flex-wrap gap-2">
          {views.map((v) => (
            <li key={v.channel}>
              <Link
                href={`/audit/${slug}/social?canale=${v.channel}` as Route}
                aria-current={v.channel === channel ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md border px-3 py-2 text-body-sm",
                  v.channel === channel
                    ? "border-primary text-fg"
                    : "border-subtle text-fg-muted hover:text-fg",
                )}
              >
                {channelLabel[v.channel]}
                {v.state ? (
                  <Badge variant={sourceStatusVariant[v.state.status]}>
                    {sourceStatusLabel[v.state.status]}
                  </Badge>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{channelLabel[channel]}</CardTitle>
            <CardDescription>
              {view.state?.unavailableReason
                ? view.state.unavailableReason
                : view.state
                  ? "Aggiungi i dati che hai."
                  : "Canale non indicato nel prospect: aggiungi il link se esiste."}
            </CardDescription>
          </CardHeader>
          {!readOnly ? (
            <ChannelSettings
              auditId={audit.id}
              channel={channel}
              profileUrl={view.state?.profileUrl ?? null}
              status={view.state?.status ?? null}
            />
          ) : null}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Metriche</CardTitle>
            <CardDescription>
              {channel === "linkedin"
                ? "LinkedIn ha le sue metriche e non si confronta con Instagram."
                : "Il tasso di interazione appare solo con follower e interazioni dalla stessa fonte."}
            </CardDescription>
          </CardHeader>
          <dl className="grid gap-3 sm:grid-cols-2">
            {view.cards.map((c) => (
              <div key={c.key} className="rounded-md border border-subtle p-3">
                <dt className="text-label text-fg-muted">{c.label}</dt>
                <dd
                  className={cn("text-heading-sm", c.value === null ? "text-fg-muted" : "text-fg")}
                >
                  {c.display}
                </dd>
                <dd className="text-body-sm text-fg-muted">
                  {c.value === null
                    ? c.reason
                    : [c.source, c.date ? formatDate(c.date) : null, c.derivedFrom]
                        .filter(Boolean)
                        .join(" · ")}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      {!readOnly && view.state?.status !== "skipped" && view.state?.status !== "unavailable" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Inserisci un valore</CardTitle>
            </CardHeader>
            <MetricForm auditId={audit.id} channel={channel} />
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Carica i dati</CardTitle>
            </CardHeader>
            <TableImport
              auditId={audit.id}
              channel={channel}
              {...(pendingFile ? { pendingSourceId: pendingFile.id } : {})}
            />
            <ScreenshotUpload auditId={audit.id} channel={channel} />
          </Card>
        </div>
      ) : null}

      {view.metrics.length || files.length || shots.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Fonti raccolte</CardTitle>
            <CardDescription>
              Rimuovendo una fonte, le osservazioni che la citano tornano da rivedere.
            </CardDescription>
          </CardHeader>
          {view.metrics.length ? (
            <ul className="flex flex-col divide-y divide-subtle">
              {view.metrics.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-body-sm"
                >
                  <span>
                    {metricLabel[m.metric] ?? m.metric}: <strong>{m.value}</strong>
                    <span className="text-fg-muted">
                      {" "}
                      · {formatDate(m.observedOn)} · {metricSourceLabels[m.source]}
                      {m.sourceNote ? ` (${m.sourceNote})` : ""}
                    </span>
                  </span>
                  {!readOnly && !m.sourceId ? (
                    <ActionButton
                      action={deleteMetricAction.bind(null, m.id)}
                      icon={<Trash2 aria-hidden />}
                      variant="ghost"
                      size="sm"
                    >
                      Rimuovi
                    </ActionButton>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {files.length ? (
            <ul className="flex flex-col divide-y divide-subtle">
              {files.map((f) => (
                <li
                  key={f.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-body-sm"
                >
                  <span>
                    {f.href ? (
                      <a href={f.href} className="text-link underline">
                        {f.fileName}
                      </a>
                    ) : (
                      f.fileName
                    )}
                    <span className="text-fg-muted">
                      {" "}
                      ·{" "}
                      {f.status === "pending"
                        ? "da importare"
                        : `${f.data.rowsImported ?? 0} righe importate${f.data.rowsSkipped ? `, ${f.data.rowsSkipped} saltate` : ""}`}
                    </span>
                  </span>
                  {!readOnly ? (
                    <ActionButton
                      action={removeSourceAction.bind(null, f.id)}
                      icon={<Trash2 aria-hidden />}
                      variant="ghost"
                      size="sm"
                      confirm="Rimuovere il file e le righe importate?"
                    >
                      Rimuovi
                    </ActionButton>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {shots.length ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {shots.map((s) => (
                <li key={s.id} className="flex flex-col gap-1">
                  {s.href ? (
                    <a href={s.href} target="_blank" rel="noreferrer noopener">
                      {/* eslint-disable-next-line @next/next/no-img-element -- signed private URL */}
                      <img
                        src={s.href}
                        alt={`Screenshot ${s.fileName ?? ""}`}
                        className="h-28 w-full rounded-sm border border-subtle object-cover"
                        loading="lazy"
                      />
                    </a>
                  ) : null}
                  <span className="truncate text-body-sm text-fg-muted">{s.fileName}</span>
                  {!readOnly ? (
                    <ActionButton
                      action={removeSourceAction.bind(null, s.id)}
                      icon={<Trash2 aria-hidden />}
                      variant="ghost"
                      size="sm"
                    >
                      Rimuovi
                    </ActionButton>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-heading-md text-fg">Osservazioni</h2>
          <div className="flex flex-wrap items-start gap-2">
            {!readOnly && aiAllowed && hasData ? (
              <ActionButton
                action={requestSocialAnalysisAction.bind(null, audit.id, channel)}
                icon={<Sparkles aria-hidden />}
                variant="primary"
                size="sm"
              >
                {view.findings.some((f) => f.authorAgent)
                  ? "Rigenera osservazioni"
                  : "Genera osservazioni"}
              </ActionButton>
            ) : null}
            {!readOnly ? (
              <AddFinding
                auditId={audit.id}
                channel={channel}
                areas={areas}
                sources={view.screenshots.map((s) => ({
                  id: s.id,
                  label: s.fileName ?? "Screenshot",
                  type: "screenshot" as const,
                }))}
              />
            ) : null}
          </div>
        </div>
        {!hasData && aiAllowed ? (
          <p className="text-body-sm text-fg-muted">
            L&apos;AI analizza solo valori e post importati: gli screenshot restano come prova.
          </p>
        ) : null}
        {view.findings.length ? (
          view.findings.map((f) => (
            <FindingCard key={f.id} finding={toView(f)} sources={links} readOnly={readOnly} />
          ))
        ) : (
          <p className="text-body-md text-fg-muted">Nessuna osservazione per questo canale.</p>
        )}
      </section>
    </div>
  );
}
