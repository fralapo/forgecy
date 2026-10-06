import { FORMATS } from "@forgecy/carousel";
import { Badge, Card } from "@forgecy/ui";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";
import { templateSource } from "../../render/_lib/templates";
import { SlideFrame } from "./slide-frame";

export const metadata = { title: "Template" };

export default async function TemplatesPage() {
  await requireUser();
  const entries = await templateSource.list();
  return (
    <>
      <PageHeader
        title="Template"
        description="Template dell'agenzia nel formato canonico (HTML, CSS e template.json) presi da templates/agency. Ogni anteprima è resa dal renderer dell'export."
      />
      {entries.length === 0 ? (
        <Card className="p-6 text-body-md text-fg-muted">
          Nessun template in <code>templates/agency</code>.
        </Card>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {entries.map(({ folder, pkg, report }) => {
            const m = pkg?.manifest;
            const errors = report.issues.length;
            const cover = m?.layouts[0];
            return (
              <li key={folder}>
                <Card className="flex h-full flex-col gap-4 p-5">
                  {m && cover ? (
                    <SlideFrame
                      src={`/render/templates/${m.id}/${cover.id}`}
                      title={`${m.name}: copertina`}
                      width={m.width}
                      height={m.height}
                      scale={0.25}
                    />
                  ) : null}
                  <div className="space-y-1">
                    <h2 className="text-heading-sm text-fg">
                      {m ? (
                        <Link href={`/template/${m.id}`} className="hover:underline">
                          {m.name}
                        </Link>
                      ) : (
                        folder
                      )}
                    </h2>
                    {m ? (
                      <p className="text-body-sm text-fg-muted">
                        {m.kind === "carousel" ? "Carosello" : "Report"} · {FORMATS[m.format].label}{" "}
                        · {m.width}×{m.height} · {m.layouts.length} layout · {m.slides.min}–
                        {m.slides.max} slide · v{m.version}
                      </p>
                    ) : null}
                  </div>
                  <div className="mt-auto flex flex-wrap gap-2">
                    {errors ? (
                      <Badge variant="error">
                        {errors === 1 ? "1 errore" : `${errors} errori`} di validazione
                      </Badge>
                    ) : (
                      <Badge variant="success">Validazione superata</Badge>
                    )}
                    <Badge>Agenzia</Badge>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
