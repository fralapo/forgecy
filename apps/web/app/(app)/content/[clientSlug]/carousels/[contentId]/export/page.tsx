import { Badge, Card } from "@forgecy/ui";
import { FileDown } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getFormat, refText } from "@/lib/i18n";
import { CarouselExportForm } from "../../../../_components/carousel-export-form";
import { getStorage } from "../../../../_lib/server";
import { outputLabels } from "../../_lib/labels";
import { isActiveJob, loadCarousel } from "../../_lib/workspace";

export async function generateMetadata() {
  const t = await getTranslations("content.export");
  return { title: t("metaTitle") };
}

interface ExportFile {
  name: string;
  key: string;
  kind: keyof typeof outputLabels;
  size: number;
}

function parseFiles(raw: unknown[]): ExportFile[] {
  return raw.flatMap((f) => {
    if (!f || typeof f !== "object") return [];
    const o = f as Record<string, unknown>;
    if (typeof o.key !== "string" || typeof o.name !== "string") return [];
    const kind = o.kind === "png" || o.kind === "pdf" || o.kind === "zip" ? o.kind : "zip";
    return [{ name: o.name, key: o.key, kind, size: typeof o.size === "number" ? o.size : 0 }];
  });
}

export default async function ExportPage({
  params,
}: {
  params: Promise<{ clientSlug: string; contentId: string }>;
}) {
  const { clientSlug, contentId } = await params;
  const { client, ws } = await loadCarousel(clientSlug, contentId);
  const c = ws.content;
  const t = await getTranslations("content.export");
  const tl = await getTranslations("content.labels");
  const format = await getFormat();
  const formatSize = (bytes: number) =>
    bytes >= 1_000_000
      ? t("sizeMb", { size: format.number(bytes / 1_000_000, { maximumFractionDigits: 1 }) })
      : t("sizeKb", { size: format.number(Math.max(1, Math.round(bytes / 1000))) });
  const canFinal = (c.status === "approved" || c.status === "exported") && !!c.approvedVersionId;
  const approvedVersion = ws.versions.find((v) => v.id === c.approvedVersionId)?.number ?? null;
  const versionNumber = new Map(ws.versions.map((v) => [v.id, v.number]));
  const exportRunning = ws.jobs.some((j) => j.kind === "content.export" && isActiveJob(j.status));

  // Signed download links only for the client's own storage keys.
  const storage = getStorage();
  const prefix = `clients/${client.id}/`;
  const exports = await Promise.all(
    ws.exports.map(async (e) => ({
      ...e,
      files: await Promise.all(
        parseFiles(e.files)
          .filter((f) => f.key.startsWith(prefix))
          .map(async (f) => ({
            ...f,
            url: await storage.signedUrl(f.key, {
              expiresInSeconds: 600,
              disposition: "attachment",
              filename: f.name,
            }),
          })),
      ),
    })),
  );
  const guard = ws.checks?.guard ?? null;
  const openFindings = await Promise.all(
    (guard?.findings ?? [])
      .filter((f) => f.status === "open")
      .map(async (f) => ({
        ...f,
        text: await refText(f.ref, f.message),
        suggestionText: f.suggestion ? await refText(f.suggestionRef, f.suggestion) : null,
      })),
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_2fr]">
      <div className="grid content-start gap-6">
        <Card className="grid gap-3 p-5">
          <h3 className="text-heading-sm text-fg">{t("new")}</h3>
          <CarouselExportForm
            slug={client.slug}
            clientId={client.id}
            contentId={c.id}
            canFinal={canFinal}
            approvedVersion={approvedVersion}
            disabled={ws.document.slides.length === 0 || exportRunning}
          />
          {ws.document.slides.length === 0 ? (
            <p className="text-body-sm text-fg-muted">{t("noSlides")}</p>
          ) : null}
        </Card>
        {guard ? (
          <Card className="grid gap-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-heading-sm text-fg">{t("guardTitle")}</h3>
              <Badge>
                {t("coherence", { band: tl(`band.${guard.coherence.band}`).toLowerCase() })}
              </Badge>
            </div>
            {openFindings.length === 0 ? (
              <p className="text-body-sm text-fg-muted">{t("noFindings")}</p>
            ) : (
              <>
                <p className="text-body-sm text-fg-muted">{t("openFindings")}</p>
                <ul className="grid gap-2">
                  {openFindings.map((f) => (
                    <li key={f.key} className="text-body-sm text-fg">
                      <Badge
                        variant={
                          f.severity === "error"
                            ? "error"
                            : f.severity === "warning"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {f.slide ? t("slide", { number: f.slide }) : t("general")}
                      </Badge>{" "}
                      {f.text}
                      {f.suggestionText ? (
                        <span className="block text-fg-muted">
                          {t("suggestion", { suggestion: f.suggestionText })}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        ) : null}
      </div>
      <Card className="grid content-start gap-3 p-5">
        <h3 className="text-heading-sm text-fg">{t("list")}</h3>
        {exports.length === 0 ? (
          <p className="text-body-sm text-fg-muted">{t("empty")}</p>
        ) : (
          <ul className="grid gap-4">
            {exports.map((e) => (
              <li key={e.id} className="grid gap-2 border-b border-subtle pb-4 last:border-0">
                <div className="flex flex-wrap items-center gap-2 text-body-sm">
                  <Badge variant={e.draft ? "neutral" : "success"}>
                    {e.draft ? t("draft") : t("final")}
                  </Badge>
                  <span className="text-fg">
                    {tl("versionShort", { number: versionNumber.get(e.versionId) ?? "?" })}
                  </span>
                  <span className="text-fg-muted">{format.date(e.createdAt, "dateTime")}</span>
                  <span className="text-fg-muted">
                    ·{" "}
                    {e.outputs
                      .map((o) => outputLabels[o as keyof typeof outputLabels] ?? o)
                      .join(", ")}
                  </span>
                </div>
                {e.files.length ? (
                  <ul className="grid gap-1">
                    {e.files.map((f) => (
                      <li key={f.key} className="text-body-sm">
                        <a
                          href={f.url}
                          download={f.name}
                          className="inline-flex items-center gap-2"
                        >
                          <FileDown aria-hidden className="size-4" />
                          {f.name}
                        </a>{" "}
                        <span className="text-fg-muted">({formatSize(f.size)})</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-body-sm text-fg-muted">{t("noFiles")}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
