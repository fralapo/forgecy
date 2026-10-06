import { getSiteView } from "@forgecy/audit";
import { WEBSITE_AREAS, type FindingArea } from "@forgecy/core";
import { Badge, Card, CardDescription, CardHeader, CardTitle } from "@forgecy/ui";
import { Check, CircleX, RefreshCw, Square, X } from "lucide-react";
import { cancelScanAction, rescanSiteAction, retryScanAction } from "../../actions";
import { ActionButton } from "../../_components/action-button";
import { AddFinding } from "../../_components/add-finding";
import { FindingCard } from "../../_components/finding-card";
import { sectionContext, sourceLinks, toView } from "../../_lib/findings";
import {
  areaLabel,
  formatDateTime,
  sourceStatusLabel,
  sourceStatusVariant,
  stepLabel,
} from "../../_lib/labels";
import { fileUrl } from "../../_lib/server";

export const metadata = { title: "Audit · Sito" };

export default async function SitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { db, audit, readOnly } = await sectionContext(slug);
  const view = await getSiteView(db, audit.id);
  const { scan, pages, findings } = view;
  const [links, shots] = await Promise.all([
    sourceLinks(db, findings),
    Promise.all(
      pages.map(async (p) => ({
        id: p.id,
        desktop: await fileUrl(p.storageKey),
        mobile: await fileUrl(p.storageKeyMobile),
      })),
    ),
  ]);
  const shotsById = new Map(shots.map((s) => [s.id, s]));
  const read = pages.filter((p) => p.status === "collected");
  const skipped = pages.filter((p) => p.status !== "collected");
  const running = scan && (scan.status === "pending" || scan.status === "collecting");
  const ex = scan?.extracted ?? {};

  if (!audit.inputs.websiteUrl)
    return (
      <Card>
        <p className="text-body-md text-fg-muted">
          Questo audit non ha un sito. Aggiungilo nei dati del prospect e avvia un nuovo audit,
          oppure prosegui con social e competitor.
        </p>
      </Card>
    );

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle>Lettura del sito</CardTitle>
            {scan ? (
              <Badge variant={sourceStatusVariant[scan.status]}>
                {sourceStatusLabel[scan.status]}
              </Badge>
            ) : null}
          </div>
          <CardDescription>
            {audit.inputs.websiteUrl} · fino a {scan?.maxPages ?? 10} pagine pubbliche, robots.txt
            rispettato{scan?.finishedAt ? ` · letto il ${formatDateTime(scan.finishedAt)}` : ""}
          </CardDescription>
        </CardHeader>
        {scan ? (
          <ol className="grid gap-2 sm:grid-cols-2">
            {scan.steps.map((s) => (
              <li key={s.key} className="flex items-start gap-2 text-body-sm">
                {s.status === "completed" ? (
                  <Check aria-hidden className="mt-0.5 size-4 text-success" />
                ) : s.status === "failed" ? (
                  <CircleX aria-hidden className="mt-0.5 size-4 text-error" />
                ) : s.status === "skipped" ? (
                  <X aria-hidden className="mt-0.5 size-4 text-fg-muted" />
                ) : (
                  <Square aria-hidden className="mt-0.5 size-4 text-fg-muted" />
                )}
                <span>
                  {stepLabel[s.key] ?? s.key}
                  {s.detail ? <span className="block text-fg-muted">{s.detail}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
        {scan?.error ? (
          <p role="alert" className="text-body-sm text-error">
            {scan.error}
            {scan.errorCode ? (
              <code className="ml-2 font-mono text-fg-muted">{scan.errorCode}</code>
            ) : null}
          </p>
        ) : null}
        {!readOnly ? (
          <div className="flex flex-wrap gap-3">
            {running && scan ? (
              <ActionButton
                action={cancelScanAction.bind(null, scan.id)}
                icon={<Square aria-hidden />}
              >
                Ferma la lettura
              </ActionButton>
            ) : scan && scan.status === "failed" ? (
              <ActionButton
                action={retryScanAction.bind(null, scan.id)}
                icon={<RefreshCw aria-hidden />}
              >
                Riprova questo passo
              </ActionButton>
            ) : (
              <ActionButton
                action={rescanSiteAction.bind(null, audit.id)}
                icon={<RefreshCw aria-hidden />}
                confirm="Rileggere il sito? Le osservazioni già rivedute restano, segnate come lettura precedente."
              >
                Rileggi il sito
              </ActionButton>
            )}
          </div>
        ) : null}
      </Card>

      {scan && (ex.colors?.length || ex.fonts?.length || ex.ctas?.length || ex.checks?.length) ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Elementi osservati</CardTitle>
              <CardDescription>Misurati sulle pagine lette, non interpretati.</CardDescription>
            </CardHeader>
            {ex.colors?.length ? (
              <div>
                <p className="mb-2 text-label text-fg-muted">Colori dominanti</p>
                <ul className="flex flex-wrap gap-3">
                  {ex.colors.map((c) => (
                    <li key={c.hex} className="flex items-center gap-2 text-body-sm">
                      <span
                        aria-hidden
                        className="size-6 rounded-sm border border-subtle"
                        style={{ backgroundColor: c.hex }}
                      />
                      <code className="font-mono">{c.hex}</code>
                      <span className="text-fg-muted">{Math.round(c.share * 100)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-body-sm text-fg-muted">
                Colori e font non misurati: Chromium non era disponibile.
              </p>
            )}
            {ex.fonts?.length ? (
              <div>
                <p className="mb-2 text-label text-fg-muted">Font</p>
                <ul className="flex flex-col gap-1 text-body-sm">
                  {ex.fonts.map((f) => (
                    <li key={f.family}>
                      {f.family}{" "}
                      <span className="text-fg-muted">
                        ·{" "}
                        {f.usage === "headings"
                          ? "titoli"
                          : f.usage === "body"
                            ? "testo"
                            : "titoli e testo"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <p className="mb-2 text-label text-fg-muted">Call to action</p>
              {ex.ctas?.length ? (
                <ul className="flex flex-col gap-1 text-body-sm">
                  {ex.ctas.slice(0, 8).map((c) => (
                    <li key={c.text}>
                      “{c.text}” <span className="text-fg-muted">· {c.pages.length} pagine</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-body-sm text-fg-muted">Nessuna call to action trovata.</p>
              )}
            </div>
            <p className="text-body-sm">
              Modulo di contatto: {ex.contactForm ? "presente" : "non trovato"} · Social collegati:{" "}
              {ex.socialLinks?.length ? ex.socialLinks.map((s) => s.channel).join(", ") : "nessuno"}
            </p>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Controlli tecnici</CardTitle>
              <CardDescription>
                Calcolati senza AI. Nessun punteggio: solo cosa va e cosa no.
              </CardDescription>
            </CardHeader>
            <ul className="flex flex-col gap-2">
              {(ex.checks ?? []).map((c) => (
                <li key={c.key} className="flex items-start gap-2 text-body-sm">
                  {c.ok ? (
                    <Check aria-hidden className="mt-0.5 size-4 text-success" />
                  ) : (
                    <CircleX aria-hidden className="mt-0.5 size-4 text-error" />
                  )}
                  <span>
                    {c.label}
                    <span className="block text-fg-muted">
                      {c.detail}
                      {c.pages.length && !c.ok ? ` · ${c.pages.slice(0, 4).join(", ")}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      {read.length ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-heading-md font-display text-fg">Pagine lette ({read.length})</h2>
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {read.map((p) => {
              const s = shotsById.get(p.id);
              return (
                <li
                  key={p.id}
                  className="flex flex-col gap-2 rounded-lg border border-subtle bg-surface p-4"
                >
                  {s?.desktop ? (
                    <a href={s.desktop} target="_blank" rel="noreferrer noopener">
                      {/* eslint-disable-next-line @next/next/no-img-element -- signed private URL */}
                      <img
                        src={s.desktop}
                        alt={`Screenshot desktop di ${p.url ?? "pagina"}`}
                        className="h-40 w-full rounded-sm border border-subtle object-cover object-top"
                        loading="lazy"
                      />
                    </a>
                  ) : null}
                  <p className="truncate text-body-sm font-medium text-fg">{p.title || p.url}</p>
                  <a
                    href={p.url ?? "#"}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="truncate text-body-sm text-link underline-offset-2 hover:underline"
                  >
                    {p.url}
                  </a>
                  {s?.mobile ? (
                    <a
                      href={s.mobile}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-body-sm text-link"
                    >
                      Screenshot mobile
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {skipped.length ? (
            <details className="text-body-sm">
              <summary className="cursor-pointer text-fg-muted">
                {skipped.length} pagine non lette
              </summary>
              <ul className="mt-2 flex flex-col gap-1">
                {skipped.map((p) => (
                  <li key={p.id}>
                    {p.url} <span className="text-fg-muted">· {p.skipReason}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-heading-md font-display text-fg">Osservazioni</h2>
          {!readOnly ? (
            <AddFinding
              auditId={audit.id}
              channel="website"
              areas={[...WEBSITE_AREAS] as FindingArea[]}
              sources={read.map((p) => ({
                id: p.id,
                label: p.title || p.url || "Pagina",
                url: p.url,
              }))}
            />
          ) : null}
        </div>
        {findings.length === 0 ? (
          <p className="text-body-md text-fg-muted">
            {scan && (scan.status === "collected" || scan.status === "partial")
              ? "Nessuna osservazione ancora. Se l'AI è attiva arrivano a fine analisi, altrimenti aggiungile tu."
              : "Le osservazioni arrivano dopo la lettura del sito."}
          </p>
        ) : (
          WEBSITE_AREAS.map((area) => {
            const list = findings.filter((f) => f.area === area);
            if (!list.length) return null;
            return (
              <div key={area} className="flex flex-col gap-3">
                <h3 className="text-heading-sm text-fg">{areaLabel[area]}</h3>
                {list.map((f) => (
                  <FindingCard
                    key={f.id}
                    finding={toView(f, scan?.id)}
                    sources={links}
                    readOnly={readOnly}
                  />
                ))}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
