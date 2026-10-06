import { getSiteView } from "@forgecy/audit";
import { WEBSITE_AREAS, type FindingArea } from "@forgecy/core";
import { Badge, Card, CardDescription, CardHeader, CardTitle } from "@forgecy/ui";
import { Check, CircleX, RefreshCw, Square, X } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getFormat, refText } from "@/lib/i18n";
import { cancelScanAction, rescanSiteAction, retryScanAction } from "../../actions";
import { ActionButton } from "../../_components/action-button";
import { AddFinding } from "../../_components/add-finding";
import { FindingCard } from "../../_components/finding-card";
import { sectionContext, sourceLinks, toView } from "../../_lib/findings";
import { sourceStatusVariant, stepLabelId } from "../../_lib/labels";
import { fileUrl } from "../../_lib/server";

const checkKeys = [
  "h1",
  "multiple_h1",
  "meta_description",
  "img_alt",
  "lang",
  "viewport",
  "load_time",
] as const;
const checkKeyOf = (key: string) => checkKeys.find((k) => k === key) ?? null;

export async function generateMetadata() {
  const t = await getTranslations("audit.website");
  return { title: t("metaTitle") };
}

export default async function SitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { db, audit, readOnly, rt } = await sectionContext(slug);
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
  const t = await getTranslations("audit");
  const format = await getFormat();
  const stepDetails = await Promise.all(
    (scan?.steps ?? []).map((s) => (s.detail ? refText(s.detailRef, s.detail) : null)),
  );
  const checkDetails = await Promise.all(
    (ex.checks ?? []).map((c) => refText(c.detailRef, c.detail)),
  );

  if (!audit.inputs.websiteUrl)
    return (
      <Card>
        <p className="text-body-md text-fg-muted">{t("website.noWebsite")}</p>
      </Card>
    );

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle>{t("website.reading")}</CardTitle>
            {scan ? (
              <Badge variant={sourceStatusVariant[scan.status]}>
                {t(`sourceStatus.${scan.status}`)}
              </Badge>
            ) : null}
          </div>
          <CardDescription>
            {scan?.finishedAt
              ? t("website.scanInfoRead", {
                  url: audit.inputs.websiteUrl,
                  max: scan.maxPages,
                  date: format.date(scan.finishedAt, "dateTime"),
                })
              : t("website.scanInfo", { url: audit.inputs.websiteUrl, max: scan?.maxPages ?? 10 })}
          </CardDescription>
        </CardHeader>
        {scan ? (
          <ol className="grid gap-2 sm:grid-cols-2">
            {scan.steps.map((s, i) => (
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
                  {stepLabelId(s.key) ? t(`step.${stepLabelId(s.key)!}`) : s.key}
                  {stepDetails[i] ? (
                    <span className="block text-fg-muted">{stepDetails[i]}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
        {scan?.error ? (
          <p role="alert" className="text-body-sm text-error">
            {rt(scan.errorRef, scan.error)}
            {scan.errorCode ? (
              <span className="mt-1 block text-fg-muted">
                {t.rich("website.errorCode", {
                  code: scan.errorCode,
                  mono: (chunks) => <code className="font-mono">{chunks}</code>,
                })}
              </span>
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
                {t("website.stop")}
              </ActionButton>
            ) : scan && scan.status === "failed" ? (
              <ActionButton
                action={retryScanAction.bind(null, scan.id)}
                icon={<RefreshCw aria-hidden />}
              >
                {t("website.retry")}
              </ActionButton>
            ) : (
              <ActionButton
                action={rescanSiteAction.bind(null, audit.id)}
                icon={<RefreshCw aria-hidden />}
                confirm={t("website.rescanConfirm")}
              >
                {t("website.rescan")}
              </ActionButton>
            )}
          </div>
        ) : null}
      </Card>

      {scan && (ex.colors?.length || ex.fonts?.length || ex.ctas?.length || ex.checks?.length) ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("website.observed")}</CardTitle>
              <CardDescription>{t("website.observedDescription")}</CardDescription>
            </CardHeader>
            {ex.colors?.length ? (
              <div>
                <p className="mb-2 text-label text-fg-muted">{t("website.colors")}</p>
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
              <p className="text-body-sm text-fg-muted">{t("website.noColors")}</p>
            )}
            {ex.fonts?.length ? (
              <div>
                <p className="mb-2 text-label text-fg-muted">{t("website.font")}</p>
                <ul className="flex flex-col gap-1 text-body-sm">
                  {ex.fonts.map((f) => (
                    <li key={f.family}>
                      {f.family}{" "}
                      <span className="text-fg-muted">· {t(`website.fontUsage.${f.usage}`)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <p className="mb-2 text-label text-fg-muted">{t("website.cta")}</p>
              {ex.ctas?.length ? (
                <ul className="flex flex-col gap-1 text-body-sm">
                  {ex.ctas.slice(0, 8).map((c) => (
                    <li key={c.text}>
                      “{c.text}”{" "}
                      <span className="text-fg-muted">
                        · {t("website.ctaPages", { count: c.pages.length })}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-body-sm text-fg-muted">{t("website.noCta")}</p>
              )}
            </div>
            <p className="text-body-sm">
              {t("website.contactForm", {
                present: ex.contactForm ? "yes" : "no",
                channels: ex.socialLinks?.length
                  ? ex.socialLinks.map((s) => s.channel).join(", ")
                  : t("website.none"),
              })}
            </p>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("website.checks")}</CardTitle>
              <CardDescription>{t("website.checksDescription")}</CardDescription>
            </CardHeader>
            <ul className="flex flex-col gap-2">
              {(ex.checks ?? []).map((c, i) => (
                <li key={c.key} className="flex items-start gap-2 text-body-sm">
                  {c.ok ? (
                    <Check aria-hidden className="mt-0.5 size-4 text-success" />
                  ) : (
                    <CircleX aria-hidden className="mt-0.5 size-4 text-error" />
                  )}
                  <span>
                    {checkKeyOf(c.key) ? t(`check.${checkKeyOf(c.key)!}.label`) : c.label}
                    <span className="block text-fg-muted">
                      {checkDetails[i]}
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
          <h2 className="text-heading-md font-display text-fg">
            {t("website.pagesRead", { count: read.length })}
          </h2>
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
                        alt={t("website.desktopAlt", { url: p.url ?? t("website.pageFallback") })}
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
                      {t("website.mobile")}
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {skipped.length ? (
            <details className="text-body-sm">
              <summary className="cursor-pointer text-fg-muted">
                {t("website.notRead", { count: skipped.length })}
              </summary>
              <ul className="mt-2 flex flex-col gap-1">
                {skipped.map((p) => (
                  <li key={p.id}>
                    {p.url}{" "}
                    <span className="text-fg-muted">· {rt(p.skipRef, p.skipReason ?? "")}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-heading-md font-display text-fg">{t("website.observations")}</h2>
          {!readOnly ? (
            <AddFinding
              auditId={audit.id}
              channel="website"
              areas={[...WEBSITE_AREAS] as FindingArea[]}
              sources={read.map((p) => ({
                id: p.id,
                label: p.title || p.url || t("website.page"),
                url: p.url,
              }))}
            />
          ) : null}
        </div>
        {findings.length === 0 ? (
          <p className="text-body-md text-fg-muted">
            {scan && (scan.status === "collected" || scan.status === "partial")
              ? t("website.noObservationsYet")
              : t("website.observationsAfterRead")}
          </p>
        ) : (
          WEBSITE_AREAS.map((area) => {
            const list = findings.filter((f) => f.area === area);
            if (!list.length) return null;
            return (
              <div key={area} className="flex flex-col gap-3">
                <h3 className="text-heading-sm text-fg">{t(`area.${area}`)}</h3>
                {list.map((f) => (
                  <FindingCard
                    key={f.id}
                    finding={toView(f, rt, scan?.id)}
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
