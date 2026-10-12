import type { TemplateManifest } from "@forgecy/carousel";
import {
  getTemplateRow,
  isPublishable,
  listTemplates,
  storedValidation,
  type TemplateStatus,
} from "@forgecy/carousel/catalog";
import { can, canAccessClient } from "@forgecy/core";
import { getDb } from "@forgecy/db";
import { Badge, Button, Card, Input, Label } from "@forgecy/ui";
import { CircleCheck, CircleMinus, CircleX, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/session";
import { revalidateAction, transitionAction } from "../actions";
import { SlideFrame } from "../slide-frame";
import { ErrorNotice, StatusBadge, ValidationBadge } from "../status";
import { checkText, issueText } from "../validation-text";
import { getManifestLocalizer } from "@/lib/template-labels";

/** Widest thumbnail that fits a layout column on a wide screen (A4 pages are 1240 px). */
// 14.5rem: the layout grid below keeps each column at least this wide.
const THUMB_MAX_WIDTH = 232;

const CHECK = {
  ok: { icon: CircleCheck, className: "text-success" },
  error: { icon: CircleX, className: "text-error" },
  warning: { icon: CircleX, className: "text-warning" },
  skipped: { icon: CircleMinus, className: "text-fg-muted" },
} as const;

const PREVIEW_OPTIONS = ["long", "safe", "slots"] as const;

async function TransitionForm({
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
  const t = await getTranslations("templates.detail.status");
  return (
    <form action={transitionAction} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="to" value={to} />
      {notes ? (
        <div className="space-y-1">
          <Label htmlFor={`notes-${to}`}>{t("versionNotes")}</Label>
          <Input
            id={`notes-${to}`}
            name="notes"
            required
            minLength={3}
            placeholder={t("notesPlaceholder")}
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
  const t = await getTranslations("templates");
  const { templateId } = await params;
  const q = await searchParams;
  const db = getDb();
  const row = await getTemplateRow(db, templateId);
  // A client's private template only for people who may open that client (ADR 0020).
  if (!row || (row.clientId && !canAccessClient(user.actor, row.clientId))) notFound();
  const m = (await getManifestLocalizer())(row.manifest as TemplateManifest);
  const validation = storedValidation(row);
  const status = row.status as TemplateStatus;
  const manage = can(user.actor, "templates.manage");
  const publishable = isPublishable(row);
  // Versions of the same owner: a client's private template with this key is another template.
  const versions = (await listTemplates(db)).filter(
    (r) => r.key === row.key && r.clientId === row.clientId,
  );

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
  const checkTexts = await Promise.all(validation.checks.map(checkText));
  const issueTexts = await Promise.all(validation.issues.map(issueText));

  return (
    <>
      <PageHeader
        title={t("detail.title", { name: m.name, version: row.version })}
        description={t("detail.description", {
          description: m.description,
          format: t(`format.${m.format}`),
          width: String(m.width),
          height: String(m.height),
          min: String(m.slides.min),
          max: String(m.slides.max),
          defaultCount: String(m.slides.default),
        })}
      />
      {q.error ? <ErrorNotice message={q.error} /> : null}
      <div className="mb-6 flex flex-wrap gap-2">
        <StatusBadge status={status} />
        <ValidationBadge validation={validation} />
        <Badge>{t(row.origin === "system" ? "origin.system" : "origin.agency")}</Badge>
      </div>
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <section aria-labelledby="layouts">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 id="layouts" className="text-heading-sm text-fg">
              {t("detail.layouts")}
            </h2>
            <nav
              aria-label={t("detail.previewOptions")}
              className="flex flex-wrap gap-2 text-body-sm"
            >
              {PREVIEW_OPTIONS.map((key) => (
                <Link
                  key={key}
                  href={toggle(key)}
                  aria-pressed={flags[key]}
                  className="rounded-md border border-subtle px-3 py-1 text-fg hover:bg-surface aria-pressed:bg-surface aria-pressed:font-medium"
                >
                  {t(`detail.preview.${key}`)}
                </Link>
              ))}
            </nav>
          </div>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(14.5rem,1fr))] gap-6">
            {m.layouts.map((layout) => (
              <li key={layout.id} className="space-y-2">
                <SlideFrame
                  src={`/render/templates/${row.id}/${layout.id}${renderQuery ? `?${renderQuery}` : ""}`}
                  title={layout.name}
                  width={m.width}
                  height={m.height}
                  scale={Math.min(0.25, THUMB_MAX_WIDTH / m.width)}
                />
                <p className="text-body-sm text-fg">
                  {layout.name}{" "}
                  <span className="text-fg-muted">
                    {t("detail.layoutMeta", {
                      role: t(`slideRole.${layout.role}`),
                      position: layout.position,
                    })}
                  </span>
                </p>
                <p className="text-body-sm text-fg-muted">
                  {layout.slots
                    .map((s) =>
                      s.type === "image"
                        ? t("detail.slot.image", { name: s.label ?? s.name })
                        : s.type === "list"
                          ? t("detail.slot.list", {
                              name: s.label ?? s.name,
                              items: String(s.maxItems),
                              chars: String(s.maxChars),
                            })
                          : t("detail.slot.text", {
                              name: s.label ?? s.name,
                              chars: String(s.maxChars),
                            }),
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
              <h2 className="text-heading-sm text-fg">{t("detail.status.title")}</h2>
              {row.versionNotes ? (
                <p className="text-body-sm text-fg">
                  {t.rich("detail.status.versionNote", {
                    notes: row.versionNotes,
                    muted: (chunks) => <span className="text-fg-muted">{chunks}</span>,
                  })}
                </p>
              ) : null}
              {(status === "draft" || status === "in_review") && !publishable ? (
                <p className="text-body-sm text-fg-muted">
                  {validation.ok ? t("detail.status.waitingRender") : t("detail.status.fixErrors")}
                </p>
              ) : null}
              {status === "draft" ? (
                <>
                  <TransitionForm
                    id={row.id}
                    to="in_review"
                    label={t("detail.status.sendForReview")}
                    notes
                    variant="secondary"
                    disabled={!publishable}
                  />
                  <TransitionForm
                    id={row.id}
                    to="published"
                    label={t("detail.status.publish")}
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
                    label={t("detail.status.publish")}
                    notes
                    disabled={!publishable}
                  />
                  <TransitionForm
                    id={row.id}
                    to="draft"
                    label={t("detail.status.backToDraft")}
                    variant="secondary"
                  />
                </>
              ) : null}
              {status === "published" ? (
                <TransitionForm
                  id={row.id}
                  to="archived"
                  label={t("detail.status.archive")}
                  variant="secondary"
                />
              ) : null}
              {status === "archived" ? (
                <TransitionForm
                  id={row.id}
                  to="published"
                  label={t("detail.status.republish")}
                  variant="secondary"
                  disabled={!publishable}
                />
              ) : null}
            </Card>
          ) : null}
          <Card className="p-5">
            <h2 className="text-heading-sm text-fg">{t("detail.validation.title")}</h2>
            <ul className="mt-4 space-y-2">
              {validation.checks.map((c, n) => {
                const s = CHECK[c.status];
                return (
                  <li key={c.id} className="flex items-start gap-2 text-body-sm text-fg">
                    <s.icon
                      aria-label={t(`detail.validation.check.${c.status}`)}
                      className={`mt-0.5 size-4 shrink-0 ${s.className}`}
                    />
                    <span>{checkTexts[n]}</span>
                  </li>
                );
              })}
              {!validation.rendered && validation.ok ? (
                <li className="flex items-start gap-2 text-body-sm text-fg-muted">
                  <LoaderCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span>{t("detail.validation.renderPending")}</span>
                </li>
              ) : null}
            </ul>
            {validation.issues.length ? (
              <ul className="mt-4 space-y-2 border-t border-subtle pt-4 text-body-sm text-error">
                {validation.issues.map((i, n) => (
                  <li key={n}>
                    {issueTexts[n]} <span className="text-fg-muted">{i.code}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {manage ? (
              <form action={revalidateAction} className="mt-4">
                <input type="hidden" name="id" value={row.id} />
                <Button type="submit" variant="ghost" size="sm">
                  {t("detail.validation.rerun")}
                </Button>
              </form>
            ) : null}
          </Card>
          {versions.length > 1 ? (
            <Card className="p-5">
              <h2 className="text-heading-sm text-fg">{t("detail.versions.title")}</h2>
              <ul className="mt-4 space-y-2 text-body-sm">
                {versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2">
                    {v.id === row.id ? (
                      <span className="font-medium text-fg">
                        {t("detail.versions.version", { version: v.version })}
                      </span>
                    ) : (
                      <Link href={`/templates/${v.id}`} className="text-link hover:underline">
                        {t("detail.versions.version", { version: v.version })}
                      </Link>
                    )}
                    <StatusBadge status={v.status} />
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Card className="p-5">
            <h2 className="text-heading-sm text-fg">{t("detail.roles.title")}</h2>
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
                  <span className="text-fg-muted">{t("detail.roles.font", { role: r.role })}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge>
                {t(m.rules.ctaOnlyLast ? "detail.roles.ctaOnlyLast" : "detail.roles.ctaAnywhere")}
              </Badge>
              <Badge>
                {t(m.rules.pageNumbers ? "detail.roles.pageNumbers" : "detail.roles.noPageNumbers")}
              </Badge>
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
