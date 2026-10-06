import { FORMATS, formatIssue, slideRoleLabels, type TemplateManifest } from "@forgecy/carousel";
import {
  getTemplateRow,
  isPublishable,
  listTemplates,
  storedValidation,
  type TemplateStatus,
} from "@forgecy/carousel/catalog";
import { can } from "@forgecy/core";
import { getDb } from "@forgecy/db";
import { Badge, Button, Card, Input, Label } from "@forgecy/ui";
import { CircleCheck, CircleMinus, CircleX, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";
import { revalidateAction, transitionAction } from "../actions";
import { SlideFrame } from "../slide-frame";
import { ErrorNotice, StatusBadge, ValidationBadge } from "../status";

const CHECK = {
  ok: { icon: CircleCheck, className: "text-success", label: "Passed" },
  error: { icon: CircleX, className: "text-error", label: "Error" },
  warning: { icon: CircleX, className: "text-warning", label: "Warning" },
  skipped: { icon: CircleMinus, className: "text-fg-muted", label: "Not checked" },
} as const;

function TransitionForm({
  id,
  to,
  label,
  notes,
  variant = "primary",
  disabled,
}: {
  id: string;
  to: TemplateStatus;
  label: string;
  notes?: boolean;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}) {
  return (
    <form action={transitionAction} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="to" value={to} />
      {notes ? (
        <div className="space-y-1">
          <Label htmlFor={`notes-${to}`}>Version notes</Label>
          <Input
            id={`notes-${to}`}
            name="notes"
            required
            minLength={3}
            placeholder="What changes"
          />
        </div>
      ) : null}
      <Button type="submit" variant={variant} disabled={disabled} className="w-full">
        {label}
      </Button>
    </form>
  );
}

export default async function TemplateDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ templateId: string }>;
  searchParams: Promise<{ long?: string; safe?: string; slots?: string; error?: string }>;
}) {
  const user = await requireUser();
  const { templateId } = await params;
  const q = await searchParams;
  const db = getDb();
  const row = await getTemplateRow(db, templateId);
  if (!row) notFound();
  const m = row.manifest as TemplateManifest;
  const validation = storedValidation(row);
  const status = row.status as TemplateStatus;
  const manage = can(user.actor, "templates.manage");
  const publishable = isPublishable(row);
  const versions = (await listTemplates(db)).filter((r) => r.key === row.key);

  const flags = { long: q.long === "1", safe: q.safe === "1", slots: q.slots === "1" };
  const query = (f: typeof flags) =>
    Object.entries(f)
      .filter(([, v]) => v)
      .map(([k]) => `${k}=1`)
      .join("&");
  const toggle = (key: keyof typeof flags) => {
    const qs = query({ ...flags, [key]: !flags[key] });
    return qs ? `/templates/${row.id}?${qs}` : `/templates/${row.id}`;
  };
  const renderQuery = query(flags);

  return (
    <>
      <PageHeader
        title={`${row.name} · v${row.version}`}
        description={`${m.description} ${FORMATS[m.format].label} · ${m.width}×${m.height} px · ${m.slides.min}–${m.slides.max} slides (default ${m.slides.default})`}
      />
      {q.error ? <ErrorNotice message={q.error} /> : null}
      <div className="mb-6 flex flex-wrap gap-2">
        <StatusBadge status={status} />
        <ValidationBadge validation={validation} />
        <Badge>{row.origin === "system" ? "System" : "Agency"}</Badge>
      </div>
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <section aria-labelledby="layouts">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 id="layouts" className="text-heading-sm text-fg">
              Layouts
            </h2>
            <nav aria-label="Preview options" className="flex flex-wrap gap-2 text-body-sm">
              {(
                [
                  ["long", "Long text"],
                  ["safe", "Safe zone"],
                  ["slots", "Slots"],
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
                  src={`/render/templates/${row.id}/${layout.id}${renderQuery ? `?${renderQuery}` : ""}`}
                  title={layout.name}
                  width={m.width}
                  height={m.height}
                  scale={0.25}
                />
                <p className="text-body-sm text-fg">
                  {layout.name}{" "}
                  <span className="text-fg-muted">
                    · {slideRoleLabels[layout.role]}
                    {layout.position === "first" ? " · first only" : ""}
                    {layout.position === "last" ? " · last only" : ""}
                  </span>
                </p>
                <p className="text-body-sm text-fg-muted">
                  {layout.slots
                    .map((s) =>
                      s.type === "image"
                        ? `${s.name} (image)`
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
          {manage ? (
            <Card className="space-y-4 p-5">
              <h2 className="text-heading-sm text-fg">Status</h2>
              {row.versionNotes ? (
                <p className="text-body-sm text-fg">
                  <span className="text-fg-muted">Note: </span>
                  {row.versionNotes}
                </p>
              ) : null}
              {(status === "draft" || status === "in_review") && !publishable ? (
                <p className="text-body-sm text-fg-muted">
                  {validation.ok
                    ? "It can be published once the test render has finished."
                    : "Fix the validation errors and import the package again."}
                </p>
              ) : null}
              {status === "draft" ? (
                <>
                  <TransitionForm
                    id={row.id}
                    to="in_review"
                    label="Send for review"
                    notes
                    variant="secondary"
                    disabled={!publishable}
                  />
                  <TransitionForm
                    id={row.id}
                    to="published"
                    label="Publish"
                    notes
                    disabled={!publishable}
                  />
                </>
              ) : null}
              {status === "in_review" ? (
                <>
                  <TransitionForm
                    id={row.id}
                    to="published"
                    label="Publish"
                    notes
                    disabled={!publishable}
                  />
                  <TransitionForm
                    id={row.id}
                    to="draft"
                    label="Back to draft"
                    variant="secondary"
                  />
                </>
              ) : null}
              {status === "published" ? (
                <TransitionForm id={row.id} to="archived" label="Archive" variant="secondary" />
              ) : null}
              {status === "archived" ? (
                <TransitionForm
                  id={row.id}
                  to="published"
                  label="Republish"
                  variant="secondary"
                  disabled={!publishable}
                />
              ) : null}
            </Card>
          ) : null}
          <Card className="p-5">
            <h2 className="text-heading-sm text-fg">Validation</h2>
            <ul className="mt-4 space-y-2">
              {validation.checks.map((c) => {
                const s = CHECK[c.status];
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
              {!validation.rendered && validation.ok ? (
                <li className="flex items-start gap-2 text-body-sm text-fg-muted">
                  <LoaderCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span>Test render in progress in the worker</span>
                </li>
              ) : null}
            </ul>
            {validation.issues.length ? (
              <ul className="mt-4 space-y-2 border-t border-subtle pt-4 text-body-sm text-error">
                {validation.issues.map((i, n) => (
                  <li key={n}>
                    {formatIssue(i)} <span className="text-fg-muted">{i.code}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {manage ? (
              <form action={revalidateAction} className="mt-4">
                <input type="hidden" name="id" value={row.id} />
                <Button type="submit" variant="ghost" size="sm">
                  Run validation again
                </Button>
              </form>
            ) : null}
          </Card>
          {versions.length > 1 ? (
            <Card className="p-5">
              <h2 className="text-heading-sm text-fg">Versions</h2>
              <ul className="mt-4 space-y-2 text-body-sm">
                {versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2">
                    {v.id === row.id ? (
                      <span className="font-medium text-fg">v{v.version}</span>
                    ) : (
                      <Link href={`/templates/${v.id}`} className="text-link hover:underline">
                        v{v.version}
                      </Link>
                    )}
                    <StatusBadge status={v.status} />
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Card className="p-5">
            <h2 className="text-heading-sm text-fg">Color and font roles</h2>
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
              <Badge>{m.rules.ctaOnlyLast ? "CTA on the last slide only" : "CTA anywhere"}</Badge>
              <Badge>{m.rules.pageNumbers ? "Page numbers" : "No page numbers"}</Badge>
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
