import { FORMATS, formatIssue, slideRoleLabels } from "@forgecy/carousel";
import { Badge, Card } from "@forgecy/ui";
import { CircleCheck, CircleMinus, CircleX } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";
import { templateSource } from "../../../render/_lib/templates";
import { SlideFrame } from "../slide-frame";

const STATUS = {
  ok: { icon: CircleCheck, className: "text-success", label: "Superato" },
  error: { icon: CircleX, className: "text-error", label: "Errore" },
  warning: { icon: CircleX, className: "text-warning", label: "Avviso" },
  skipped: { icon: CircleMinus, className: "text-fg-muted", label: "Non verificato" },
} as const;

export default async function TemplateDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ templateId: string }>;
  searchParams: Promise<{ long?: string; safe?: string; slots?: string }>;
}) {
  await requireUser();
  const { templateId } = await params;
  const q = await searchParams;
  const entry = (await templateSource.list()).find((e) => e.pkg?.manifest.id === templateId);
  if (!entry?.pkg) notFound();
  const m = entry.pkg.manifest;
  const flags = { long: q.long === "1", safe: q.safe === "1", slots: q.slots === "1" };
  const toggle = (key: keyof typeof flags) => {
    const next = { ...flags, [key]: !flags[key] };
    const qs = Object.entries(next)
      .filter(([, v]) => v)
      .map(([k]) => `${k}=1`)
      .join("&");
    return qs ? `/template/${m.id}?${qs}` : `/template/${m.id}`;
  };
  const renderQuery = Object.entries(flags)
    .filter(([, v]) => v)
    .map(([k]) => `${k}=1`)
    .join("&");

  return (
    <>
      <PageHeader
        title={m.name}
        description={`${m.description} ${FORMATS[m.format].label} · ${m.width}×${m.height} px · ${m.slides.min}–${m.slides.max} slide (default ${m.slides.default}) · v${m.version}`}
      />
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <section aria-labelledby="layouts">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 id="layouts" className="text-heading-sm text-fg">
              Layout
            </h2>
            <nav aria-label="Opzioni di anteprima" className="flex flex-wrap gap-2 text-body-sm">
              {(
                [
                  ["long", "Testi lunghi"],
                  ["safe", "Safe zone"],
                  ["slots", "Slot"],
                ] as const
              ).map(([key, label]) => (
                <Link
                  key={key}
                  href={toggle(key)}
                  aria-pressed={flags[key]}
                  className="rounded-md border border-subtle px-3 py-1 text-fg hover:bg-surface aria-pressed:bg-surface aria-pressed:font-medium"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {m.layouts.map((layout) => (
              <li key={layout.id} className="space-y-2">
                <SlideFrame
                  src={`/render/templates/${m.id}/${layout.id}${renderQuery ? `?${renderQuery}` : ""}`}
                  title={`${layout.name}`}
                  width={m.width}
                  height={m.height}
                  scale={0.25}
                />
                <p className="text-body-sm text-fg">
                  {layout.name}{" "}
                  <span className="text-fg-muted">
                    · {slideRoleLabels[layout.role]}
                    {layout.position === "first" ? " · solo prima" : ""}
                    {layout.position === "last" ? " · solo ultima" : ""}
                  </span>
                </p>
                <p className="text-body-sm text-fg-muted">
                  {layout.slots
                    .map((s) =>
                      s.type === "image"
                        ? `${s.name} (immagine)`
                        : s.type === "list"
                          ? `${s.name} · ${s.maxItems}×${s.maxChars}`
                          : `${s.name} · ${s.maxChars}`,
                    )
                    .join(", ")}
                </p>
              </li>
            ))}
          </ul>
        </section>
        <aside className="space-y-6">
          <Card className="p-5">
            <h2 className="text-heading-sm text-fg">Validazione</h2>
            <ul className="mt-4 space-y-2">
              {entry.report.checks.map((c) => {
                const s = STATUS[c.status];
                return (
                  <li key={c.id} className="flex items-start gap-2 text-body-sm text-fg">
                    <s.icon
                      aria-label={s.label}
                      className={`mt-0.5 size-4 shrink-0 ${s.className}`}
                    />
                    <span>{c.label}</span>
                  </li>
                );
              })}
            </ul>
            {entry.report.issues.length ? (
              <ul className="mt-4 space-y-2 border-t border-subtle pt-4 text-body-sm text-error">
                {entry.report.issues.map((i, n) => (
                  <li key={n}>
                    {formatIssue(i)} <span className="text-fg-muted">{i.code}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-4 text-body-sm text-fg-muted">
              Render di prova e controllo dei testi lunghi girano nel worker con Chromium.
            </p>
          </Card>
          <Card className="p-5">
            <h2 className="text-heading-sm text-fg">Ruoli colore e font</h2>
            <ul className="mt-4 space-y-1 text-body-sm">
              {Object.entries(m.colorRoles).map(([name, r]) => (
                <li key={name} className="flex justify-between gap-2">
                  <code className="text-fg">{name}</code>
                  <span className="text-fg-muted">{r.role}</span>
                </li>
              ))}
              {Object.entries(m.fontRoles).map(([name, r]) => (
                <li key={name} className="flex justify-between gap-2">
                  <code className="text-fg">{name}</code>
                  <span className="text-fg-muted">font {r.role}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge>{m.rules.ctaOnlyLast ? "CTA solo nell'ultima" : "CTA libera"}</Badge>
              <Badge>{m.rules.pageNumbers ? "Numeri di pagina" : "Senza numeri di pagina"}</Badge>
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
