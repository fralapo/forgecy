import { FORMATS, type TemplateManifest } from "@forgecy/carousel";
import {
  compareVersions,
  listTemplates,
  storedValidation,
  type TemplateRow,
} from "@forgecy/carousel/catalog";
import { scanTemplateDir } from "@forgecy/carousel/node";
import { can } from "@forgecy/core";
import { getDb } from "@forgecy/db";
import { Badge, Button, Card, Input, Label } from "@forgecy/ui";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";
import { importFolderAction } from "./actions";
import { SlideFrame } from "./slide-frame";
import { ErrorNotice, StatusBadge, ValidationBadge } from "./status";

export const metadata = { title: "Template" };

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
  searchParams: Promise<{ errore?: string }>;
}) {
  const user = await requireUser();
  const { errore } = await searchParams;
  const manage = can(user.actor, "templates.manage");
  const rows = await listTemplates(getDb());
  const byKey = new Map<string, TemplateRow[]>();
  for (const row of rows) byKey.set(row.key, [...(byKey.get(row.key) ?? []), row]);
  const known = new Set(rows.map((r) => `${r.key}@${r.version}`));
  const folders = manage
    ? (await scanTemplateDir()).filter(
        (e) => !e.pkg || !known.has(`${e.pkg.manifest.id}@${e.pkg.manifest.version}`),
      )
    : [];

  return (
    <>
      <PageHeader
        title="Template"
        description="Catalogo dei template nel formato canonico (HTML, CSS e template.json). Le anteprime sono rese dallo stesso renderer dell'export; i contenuti usano solo versioni pubblicate."
      />
      {errore ? <ErrorNotice message={errore} /> : null}
      {byKey.size === 0 ? (
        <Card className="mb-8 p-6 text-body-md text-fg-muted">
          Il catalogo è vuoto. Importa un template dalla cartella dell&apos;agenzia o da uno ZIP.
        </Card>
      ) : (
        <ul className="mb-10 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {[...byKey.values()].map((versions) => {
            const row = headline(versions);
            const m = row.manifest as TemplateManifest;
            const cover = m.layouts[0];
            const others = versions.length - 1;
            return (
              <li key={row.key}>
                <Card className="flex h-full flex-col gap-4 p-5">
                  {cover ? (
                    <SlideFrame
                      src={`/render/templates/${row.id}/${cover.id}`}
                      title={`${row.name}: copertina`}
                      width={m.width}
                      height={m.height}
                      scale={0.25}
                    />
                  ) : null}
                  <div className="space-y-1">
                    <h2 className="text-heading-sm text-fg">
                      <Link href={`/templates/${row.id}`} className="hover:underline">
                        {row.name}
                      </Link>
                    </h2>
                    <p className="text-body-sm text-fg-muted">
                      {m.kind === "carousel" ? "Carosello" : "Report"} · {FORMATS[m.format].label} ·{" "}
                      {m.layouts.length} layout · {m.slides.min}–{m.slides.max} slide · v
                      {row.version}
                      {others
                        ? ` · ${others === 1 ? "1 altra versione" : `${others} altre versioni`}`
                        : ""}
                    </p>
                  </div>
                  <div className="mt-auto flex flex-wrap gap-2">
                    <StatusBadge status={row.status} />
                    <ValidationBadge validation={storedValidation(row)} />
                    <Badge>{row.origin === "system" ? "Sistema" : "Agenzia"}</Badge>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {manage ? (
        <section aria-labelledby="importa" className="space-y-6">
          <h2 id="importa" className="text-heading-sm text-fg">
            Importa
          </h2>
          <Card className="p-5">
            <form
              action="/templates/import"
              method="post"
              encType="multipart/form-data"
              className="flex flex-wrap items-end gap-4"
            >
              <div className="min-w-64 flex-1 space-y-2">
                <Label htmlFor="package">Pacchetto ZIP (massimo 50 MB)</Label>
                <Input
                  id="package"
                  name="package"
                  type="file"
                  accept=".zip,application/zip"
                  required
                />
              </div>
              <Button type="submit">Importa template</Button>
            </form>
            <p className="mt-3 text-body-sm text-fg-muted">
              Il pacchetto diventa una bozza. Se la stessa versione è già una bozza, ne sostituisce
              i file; per una versione in revisione o pubblicata aumenta &quot;version&quot; in
              template.json.
            </p>
          </Card>
          {folders.length ? (
            <div className="space-y-3">
              <h3 className="text-body-md font-medium text-fg">
                Da importare dalla cartella dell&apos;agenzia
              </h3>
              <ul className="space-y-2">
                {folders.map(({ folder, pkg, report }) => (
                  <li key={folder}>
                    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="text-body-sm">
                        <p className="font-medium text-fg">
                          {pkg ? `${pkg.manifest.name} · v${pkg.manifest.version}` : folder}
                        </p>
                        <p className="text-fg-muted">
                          <code>templates/{folder}</code>
                          {report.issues.length
                            ? ` · ${report.issues.length === 1 ? "1 errore" : `${report.issues.length} errori`} di validazione`
                            : ""}
                        </p>
                      </div>
                      {pkg ? (
                        <form action={importFolderAction}>
                          <input type="hidden" name="folder" value={folder} />
                          <Button type="submit" variant="secondary" size="sm">
                            Importa
                          </Button>
                        </form>
                      ) : (
                        <Badge variant="error">Manifest non valido</Badge>
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
