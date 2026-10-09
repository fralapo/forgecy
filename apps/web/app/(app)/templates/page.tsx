import type { TemplateManifest } from "@forgecy/carousel";
import {
  compareVersions,
  listTemplates,
  storedValidation,
  type TemplateRow,
} from "@forgecy/carousel/catalog";
import { scanTemplateDir } from "@forgecy/carousel/node";
import { can, canAccessClient } from "@forgecy/core";
import { getDb } from "@forgecy/db";
import { Badge, Button, Card, Input, Label } from "@forgecy/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";
import { importFolderAction } from "./actions";
import { SlideFrame } from "./slide-frame";
import { ErrorNotice, StatusBadge, ValidationBadge } from "./status";
import { getManifestLocalizer } from "@/lib/template-labels";

export async function generateMetadata() {
  const t = await getTranslations("templates");
  return { title: t("title") };
}

const SEPARATOR = " · ";
// Folder of the repository scanned by the import (a path, not language).
const TEMPLATES_DIR = "templates";

/** The version to show for a key: the published one, else the most recent. */
function headline(rows: TemplateRow[]): TemplateRow {
  return (
    rows.find((r) => r.status === "published") ??
    [...rows].sort((a, b) => compareVersions(b.version, a.version))[0]!
  );
}

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const t = await getTranslations("templates");
  const { error } = await searchParams;
  const manage = can(user.actor, "templates.manage");
  // A client's private template only for people who may open that client (ADR 0020).
  const rows = (await listTemplates(getDb())).filter(
    (r) => !r.clientId || canAccessClient(user.actor, r.clientId),
  );
  const byKey = new Map<string, TemplateRow[]>();
  for (const row of rows) byKey.set(row.key, [...(byKey.get(row.key) ?? []), row]);
  const known = new Set(rows.map((r) => `${r.key}@${r.version}`));
  const folders = manage
    ? (await scanTemplateDir()).filter(
        (e) => !e.pkg || !known.has(`${e.pkg.manifest.id}@${e.pkg.manifest.version}`),
      )
    : [];

  const localize = await getManifestLocalizer();
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      {error ? <ErrorNotice message={error} /> : null}
      {byKey.size === 0 ? (
        <Card className="mb-8 p-6 text-body-md text-fg-muted">{t("empty")}</Card>
      ) : (
        <ul className="mb-10 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {[...byKey.values()].map((versions) => {
            const row = headline(versions);
            const m = localize(row.manifest as TemplateManifest);
            const cover = m.layouts[0];
            const others = versions.length - 1;
            return (
              <li key={row.key}>
                <Card className="flex h-full flex-col gap-4 p-5">
                  {cover ? (
                    <SlideFrame
                      src={`/render/templates/${row.id}/${cover.id}`}
                      title={t("catalog.coverTitle", { name: m.name })}
                      width={m.width}
                      height={m.height}
                      scale={0.25}
                    />
                  ) : null}
                  <div className="space-y-1">
                    <h2 className="text-heading-sm text-fg">
                      <Link href={`/templates/${row.id}`} className="hover:underline">
                        {m.name}
                      </Link>
                    </h2>
                    <p className="text-body-sm text-fg-muted">
                      {t("catalog.summary", {
                        kind: t(`kind.${m.kind}`),
                        format: t(`format.${m.format}`),
                        layouts: m.layouts.length,
                        min: String(m.slides.min),
                        max: String(m.slides.max),
                        version: row.version,
                        others,
                      })}
                    </p>
                  </div>
                  <div className="mt-auto flex flex-wrap gap-2">
                    <StatusBadge status={row.status} />
                    <ValidationBadge validation={storedValidation(row)} />
                    <Badge>{t(row.origin === "system" ? "origin.system" : "origin.agency")}</Badge>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {manage ? (
        <section aria-labelledby="import" className="space-y-6">
          <h2 id="import" className="text-heading-sm text-fg">
            {t("import.title")}
          </h2>
          <Card className="p-5">
            <form
              action="/templates/import"
              method="post"
              encType="multipart/form-data"
              className="flex flex-wrap items-end gap-4"
            >
              <div className="min-w-64 flex-1 space-y-2">
                <Label htmlFor="package">{t("import.zipLabel")}</Label>
                <Input
                  id="package"
                  name="package"
                  type="file"
                  accept=".zip,application/zip"
                  required
                />
              </div>
              <Button type="submit">{t("import.submit")}</Button>
            </form>
            <p className="mt-3 text-body-sm text-fg-muted">{t("import.help")}</p>
          </Card>
          {folders.length ? (
            <div className="space-y-3">
              <h3 className="text-body-md font-medium text-fg">{t("import.folderTitle")}</h3>
              <ul className="space-y-2">
                {folders.map(({ folder, pkg, report }) => (
                  <li key={folder}>
                    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="text-body-sm">
                        <p className="font-medium text-fg">
                          {pkg
                            ? t("import.folderName", {
                                name: localize(pkg.manifest).name,
                                version: pkg.manifest.version,
                              })
                            : folder}
                        </p>
                        <p className="text-fg-muted">
                          <code>{`${TEMPLATES_DIR}/${folder}`}</code>
                          {report.issues.length ? (
                            <>
                              {SEPARATOR}
                              {t("import.folderErrors", { count: report.issues.length })}
                            </>
                          ) : null}
                        </p>
                      </div>
                      {pkg ? (
                        <form action={importFolderAction}>
                          <input type="hidden" name="folder" value={folder} />
                          <Button type="submit" variant="secondary" size="sm">
                            {t("import.folderSubmit")}
                          </Button>
                        </form>
                      ) : (
                        <Badge variant="error">{t("import.invalidManifest")}</Badge>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
