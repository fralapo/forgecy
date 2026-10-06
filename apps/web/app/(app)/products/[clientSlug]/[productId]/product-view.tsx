"use client";

import type { ConfidenceLevel, ProductStatus } from "@forgecy/core";
import {
  fieldDefs,
  isEmptyValue,
  LIMITS,
  type FieldDef,
  type FieldKey,
  type ProductFields,
  type ProductVariant,
} from "@forgecy/catalog/fields";
import type { ClaimKind } from "@forgecy/catalog/sensitive";
import { Badge, Button, Card, cn } from "@forgecy/ui";
import {
  BadgeCheck,
  ExternalLink,
  ImagePlus,
  ScanEye,
  ShieldAlert,
  Sparkles,
  User,
} from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, type ReactNode } from "react";
import { ActionMessage, ConfirmDialog, useCatalogAction } from "../../_components/client";
import { Banner, Thumb, textareaClass } from "../../_components/ui";
import { fromText, toText } from "../../_lib/field-text";
import { fieldLabel } from "../../_lib/labels";
import { transitionAction } from "../actions";
import {
  acceptSensitiveAction,
  decideProposalAction,
  deleteAction,
  duplicateAction,
  imageAction,
  saveFieldAction,
} from "./actions";

interface FieldMetaView {
  truth: "observed" | "proposed" | "approved";
  confidence: ConfidenceLevel;
  source: string;
  byAgent: boolean;
  sensitive: ClaimKind[];
  accepted: boolean;
  page: number | null;
  fileId: string | null;
}

export interface ProductViewData {
  clientId: string;
  clientSlug: string;
  clientName: string;
  id: string;
  name: string;
  status: ProductStatus;
  revision: number;
  byAgent: boolean;
  fields: ProductFields;
  meta: Partial<Record<string, FieldMetaView | undefined>>;
  blockers: string[];
  pendingSensitive: FieldKey[];
  images: Array<{
    id: string;
    url: string | null;
    alt: string;
    fileName: string;
    status: "draft" | "approved";
    isPrimary: boolean;
    method: string;
    confidence: ConfidenceLevel;
  }>;
  proposals: Array<{
    id: string;
    field: FieldKey;
    label: string;
    current: string;
    proposed: string;
    proposedRaw: unknown;
    source: string;
    status: string;
    when: string;
    decidedBy: string | null;
  }>;
  history: Array<{
    id: string;
    label: string;
    who: string;
    when: string;
    field: string | null;
    note: string | null;
  }>;
  sources: Array<{ label: string; href: string; external: boolean; fileId?: string }>;
  approvedBy: string | null;
  approvedAt: string | null;
  createdBy: string | null;
  sourceImportHref: Route | null;
}

const methods = ["folder", "filename", "sku", "sheet", "ai", "manual"] as const;
type Method = (typeof methods)[number];
const isMethod = (m: string): m is Method => (methods as readonly string[]).includes(m);

const sections: FieldDef["section"][] = [
  "identity",
  "descriptions",
  "specs",
  "benefits",
  "variants",
  "commercial",
  "notes",
];

const hidden = (chunks: ReactNode) => <span className="sr-only">{chunks}</span>;

type Tab = "sources" | "proposals" | "history" | "usage";

export function ProductView({ data }: { data: ProductViewData }) {
  const t = useTranslations("products");
  const router = useRouter();
  const action = useCatalogAction();
  const [tab, setTab] = useState<Tab>(
    data.proposals.some((p) => p.status === "proposed") ? "proposals" : "history",
  );
  const open = data.proposals.filter((p) => p.status === "proposed");
  const base = { clientId: data.clientId };
  const transition = (
    a: "approve" | "reject" | "archive" | "to_draft" | "restore",
    note?: string,
  ) =>
    action.run(() =>
      transitionAction({
        ...base,
        ids: [data.id],
        action: a,
        note,
        revisions: { [data.id]: data.revision },
      }),
    );
  const missing = fieldDefs
    .filter((f) => ["shortDescription", "benefits", "materials", "usage"].includes(f.key))
    .filter((f) => isEmptyValue(data.fields[f.key]))
    .map((f) => fieldLabel(t, f.key).toLocaleLowerCase());
  if (data.images.length === 0) missing.push(t("product.missingImages"));

  const nextAction = open.length
    ? t("product.nextProposals", { count: open.length })
    : data.pendingSensitive.length
      ? t("product.nextSensitive", { count: data.pendingSensitive.length })
      : missing.length
        ? t("product.nextMissing", { fields: missing.join(", ") })
        : data.status === "approved"
          ? t("noPendingActions")
          : t("product.nextApprove");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm text-fg-muted">
          <span className="font-medium text-fg">{t("nextAction")} </span>
          {nextAction}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {data.status === "draft" || data.status === "proposed" ? (
            <ConfirmDialog
              title={t("product.approveTitle", { name: data.name })}
              confirmLabel={t("product.approve")}
              disabled={data.blockers.length > 0}
              onConfirm={(f) => transition("approve", String(f.get("note") ?? ""))}
              trigger={(openDialog) => (
                <Button
                  onClick={openDialog}
                  disabled={action.pending || data.blockers.length > 0}
                  title={data.blockers[0]}
                >
                  <BadgeCheck aria-hidden />
                  {t("product.approve")}
                </Button>
              )}
            >
              <p>{t("product.approveBody", { client: data.clientName })}</p>
              <label className="block text-body-sm text-fg">
                {t("noteOptional")}
                <textarea
                  name="note"
                  rows={2}
                  maxLength={1000}
                  className={cn(textareaClass, "mt-1")}
                />
              </label>
            </ConfirmDialog>
          ) : null}
          {data.status === "approved" && open.length ? (
            <Button onClick={() => setTab("proposals")}>{t("product.reviewProposals")}</Button>
          ) : null}
          {data.status === "rejected" ? (
            <Button onClick={() => transition("to_draft")} disabled={action.pending}>
              {t("product.toDraft")}
            </Button>
          ) : null}
          {data.status === "archived" ? (
            <Button onClick={() => transition("restore")} disabled={action.pending}>
              {t("product.restore")}
            </Button>
          ) : null}
          {data.status === "draft" || data.status === "proposed" ? (
            <ConfirmDialog
              title={t("product.rejectTitle", { name: data.name })}
              confirmLabel={t("product.reject")}
              onConfirm={(f) => transition("reject", String(f.get("note") ?? ""))}
              trigger={(openDialog) => (
                <Button variant="secondary" onClick={openDialog} disabled={action.pending}>
                  {t("product.reject")}
                </Button>
              )}
            >
              <label className="block text-body-sm text-fg">
                {t("reasonOptional")}
                <textarea
                  name="note"
                  rows={2}
                  maxLength={1000}
                  className={cn(textareaClass, "mt-1")}
                />
              </label>
            </ConfirmDialog>
          ) : null}
          <Button
            variant="secondary"
            disabled={action.pending}
            onClick={() =>
              action.run(() =>
                duplicateAction({ ...base, clientSlug: data.clientSlug, productId: data.id }),
              )
            }
          >
            {t("product.duplicate")}
          </Button>
          {data.sourceImportHref ? (
            <Button asChild variant="ghost">
              <Link href={data.sourceImportHref}>{t("product.openSourceImport")}</Link>
            </Button>
          ) : null}
          {data.status !== "archived" ? (
            <ConfirmDialog
              title={t("product.archiveTitle", { name: data.name })}
              confirmLabel={t("product.archive")}
              danger
              onConfirm={() => transition("archive")}
              trigger={(openDialog) => (
                <Button variant="ghost" onClick={openDialog} disabled={action.pending}>
                  {t("product.archive")}
                </Button>
              )}
            >
              <p>{t("product.archiveBody")}</p>
            </ConfirmDialog>
          ) : null}
          <ConfirmDialog
            title={t("product.deleteTitle", { name: data.name })}
            confirmLabel={t("product.delete")}
            danger
            onConfirm={(f) =>
              action.run(() =>
                deleteAction({
                  ...base,
                  clientSlug: data.clientSlug,
                  productId: data.id,
                  typedName: String(f.get("typedName") ?? ""),
                }),
              )
            }
            trigger={(openDialog) => (
              <Button variant="ghost" onClick={openDialog} disabled={action.pending}>
                {t("product.deletePermanently")}
              </Button>
            )}
          >
            <p>{t("product.deleteBody")}</p>
            <input
              name="typedName"
              required
              aria-label={t("product.typedName")}
              autoComplete="off"
              className={textareaClass}
            />
          </ConfirmDialog>
        </div>
      </div>
      <ActionMessage result={action.result} />
      {data.status === "draft" && data.blockers.length ? (
        <Banner tone="warning">{t("product.draftBanner")}</Banner>
      ) : null}
      {data.status === "approved" && action.result?.edited ? (
        <Banner tone="warning">{t("product.editedApproved")}</Banner>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <Gallery data={data} onChanged={() => router.refresh()} />
          {sections.map((section) => (
            <Section key={section} section={section} data={data} />
          ))}
        </div>
        <aside aria-label={t("product.details")} className="space-y-3">
          <div role="tablist" aria-label={t("product.panel")} className="flex flex-wrap gap-1">
            {(
              [
                ["sources", t("product.tabs.sources")],
                [
                  "proposals",
                  open.length
                    ? t("product.tabs.proposalsCount", { count: open.length })
                    : t("product.tabs.proposals"),
                ],
                ["history", t("product.tabs.history")],
                ["usage", t("product.tabs.usage")],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id}
                role="tab"
                aria-selected={tab === id}
                size="sm"
                variant={tab === id ? "secondary" : "ghost"}
                onClick={() => setTab(id)}
              >
                {label}
              </Button>
            ))}
          </div>
          <Card className="gap-3 p-4" role="tabpanel">
            {tab === "sources" ? (
              <ul className="space-y-2 text-body-sm">
                {data.createdBy ? (
                  <li className="text-fg-muted">
                    {t("product.createdBy", { name: data.createdBy })}
                  </li>
                ) : null}
                {data.approvedBy ? (
                  <li className="text-fg-muted">
                    {t("product.approvedBy", {
                      name: data.approvedBy,
                      date: data.approvedAt ?? "",
                    })}
                  </li>
                ) : null}
                {data.sources.length === 0 ? (
                  <li className="text-fg-muted">{t("product.enteredByHand")}</li>
                ) : null}
                {data.sources.map((s) => (
                  <li key={s.href}>
                    {s.external ? (
                      <a
                        href={s.href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-link hover:underline"
                      >
                        {s.label}
                        <ExternalLink aria-hidden className="size-4" />
                      </a>
                    ) : (
                      <Link href={s.href as Route} className="text-link hover:underline">
                        {s.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            {tab === "proposals" ? (
              data.proposals.length === 0 ? (
                <p className="text-body-sm text-fg-muted">{t("product.noProposals")}</p>
              ) : (
                <ul className="space-y-3">
                  {data.proposals.map((p) => (
                    <li key={p.id} className="border-b border-subtle pb-3 last:border-0">
                      <ProposalDiff p={p} clientId={data.clientId} />
                    </li>
                  ))}
                </ul>
              )
            ) : null}
            {tab === "history" ? (
              <ol className="space-y-2 text-body-sm">
                {data.history.map((h) => (
                  <li key={h.id}>
                    <span className="text-fg">
                      {h.label}
                      {h.field ? ` · ${h.field}` : ""}
                    </span>
                    <span className="block text-fg-muted">
                      {h.who} · {h.when}
                    </span>
                    {h.note ? <span className="block text-fg-muted">“{h.note}”</span> : null}
                  </li>
                ))}
              </ol>
            ) : null}
            {tab === "usage" ? (
              <p className="text-body-sm text-fg-muted">{t("product.noUsage")}</p>
            ) : null}
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Gallery({ data, onChanged }: { data: ProductViewData; onChanged: () => void }) {
  const t = useTranslations("products");
  const input = useRef<HTMLInputElement>(null);
  const action = useCatalogAction();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    for (const file of Array.from(files)) {
      const res = await fetch(`/products/${data.clientSlug}/${data.id}/images`, {
        method: "POST",
        body: file,
        headers: { "x-file-name": encodeURIComponent(file.name) },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? t("product.notUploaded", { name: file.name }));
      }
    }
    setUploading(false);
    if (input.current) input.current.value = "";
    onChanged();
  }
  const img = (id: string, a: "primary" | "unlink" | "approve") =>
    action.run(() => imageAction({ clientId: data.clientId, imageId: id, action: a }));
  return (
    <Card className="gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-heading-sm">{t("product.photos")}</h2>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => input.current?.click()}
          disabled={uploading}
        >
          <ImagePlus aria-hidden />
          {uploading ? t("product.uploading") : t("product.addImage")}
        </Button>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={(e) => void upload(e.target.files)}
        />
      </div>
      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
      <ActionMessage result={action.result} />
      {data.images.length === 0 ? (
        <p className="text-body-sm text-fg-muted">{t("product.noImages")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-4">
          {data.images.map((i) => (
            <li key={i.id} className="space-y-2">
              <Thumb url={i.url} alt={i.alt} size="lg" />
              <div className="flex flex-wrap gap-1">
                {i.isPrimary ? <Badge variant="info">{t("product.primary")}</Badge> : null}
                <Badge variant={i.status === "approved" ? "success" : "neutral"}>
                  {i.status === "approved" ? t("product.imageApproved") : t("product.imageDraft")}
                </Badge>
              </div>
              <p className="text-body-sm text-fg-muted">
                {i.fileName} · {isMethod(i.method) ? t(`product.methods.${i.method}`) : i.method}
                {i.method === "ai" ? ` · ${t(`confidenceOf.${i.confidence}`)}` : ""}
              </p>
              {i.status === "draft" ? (
                <p className="text-body-sm text-fg-muted">{t("product.approveToUse")}</p>
              ) : null}
              <div className="flex flex-wrap gap-1">
                {i.status === "draft" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => img(i.id, "approve")}
                    disabled={action.pending}
                  >
                    {t("approve")}
                  </Button>
                ) : null}
                {!i.isPrimary ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => img(i.id, "primary")}
                    disabled={action.pending}
                  >
                    {t("product.setPrimary")}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => img(i.id, "unlink")}
                  disabled={action.pending}
                >
                  {t("product.unlink")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Section({ section, data }: { section: FieldDef["section"]; data: ProductViewData }) {
  const t = useTranslations("products");
  const defs = fieldDefs.filter((f) => f.section === section);
  const empty = defs.every((f) => isEmptyValue(data.fields[f.key]));
  const body = (
    <div className="space-y-4">
      {section === "specs" && empty ? (
        <p className="text-body-sm text-fg-muted">{t("product.specsEmpty")}</p>
      ) : null}
      {section === "commercial" ? (
        <p className="text-body-sm text-fg-muted">{t("product.commercialNote")}</p>
      ) : null}
      {defs.map((def) => (
        <FieldRow key={def.key} def={def} data={data} />
      ))}
    </div>
  );
  if (section === "commercial")
    return (
      <Card>
        <details open={!empty}>
          <summary className="cursor-pointer text-heading-sm">
            {t(`sections.${section}`)}
            {empty ? (
              <span className="ml-2 text-body-sm text-fg-muted">{t("product.noCommercial")}</span>
            ) : null}
          </summary>
          <div className="mt-4">{body}</div>
        </details>
      </Card>
    );
  return (
    <Card>
      <h2 className="text-heading-sm">{t(`sections.${section}`)}</h2>
      {body}
    </Card>
  );
}

function FieldRow({ def, data }: { def: FieldDef; data: ProductViewData }) {
  const t = useTranslations("products");
  const label = fieldLabel(t, def.key);
  const placeholder =
    def.key === "shortDescription" ? t("fieldPlaceholders.shortDescription") : undefined;
  const value = data.fields[def.key];
  const meta = data.meta[def.key];
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(() => toText(def, value));
  const action = useCatalogAction();
  const proposals = data.proposals.filter((p) => p.field === def.key && p.status === "proposed");
  const id = `field-${def.key}`;
  const multiline = def.kind !== "text";
  const max =
    def.key === "shortDescription"
      ? LIMITS.shortDescription
      : def.key === "longDescription"
        ? LIMITS.longDescription
        : undefined;
  const pendingSensitive = !!meta?.sensitive.length && !meta.accepted && !isEmptyValue(value);
  const pdfSource = meta?.fileId ? data.sources.find((s) => s.fileId === meta.fileId) : undefined;

  function save() {
    action.run(
      () =>
        saveFieldAction({
          clientId: data.clientId,
          productId: data.id,
          revision: data.revision,
          field: def.key,
          value: fromText(def, text),
        }),
      (r) => r.ok && setEditing(false),
    );
  }

  return (
    <div id={id} className="border-b border-subtle pb-4 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <label htmlFor={`${id}-input`} className="text-label font-medium text-fg">
          {label}
          {def.kind === "list" || def.kind === "tags" ? (
            <span className="ml-1 font-normal text-fg-muted">{t("product.onePerLine")}</span>
          ) : null}
          {def.kind === "variants" ? (
            <span className="ml-1 font-normal text-fg-muted">{t("product.variantsHint")}</span>
          ) : null}
        </label>
        {!editing ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            {t.rich("editField", { field: label, hidden })}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          {multiline ? (
            <textarea
              id={`${id}-input`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={def.kind === "longtext" ? 4 : 3}
              maxLength={max}
              placeholder={placeholder}
              className={textareaClass}
              onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
            />
          ) : (
            <input
              id={`${id}-input`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className={cn(textareaClass, def.key === "sku" && "font-mono")}
              onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
            />
          )}
          {max ? (
            <p className="text-body-sm text-fg-muted">
              {text.length} / {max}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={action.pending}>
              {action.pending ? t("saving") : t("save")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : isEmptyValue(value) ? (
        <p className="mt-1 text-body-sm text-fg-muted">{placeholder ?? "—"}</p>
      ) : (
        <FieldValue def={def} value={value} />
      )}
      <ActionMessage result={action.result} />
      {meta && !isEmptyValue(value) ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-body-sm text-fg-muted">
          <TruthBadge truth={meta.truth} byAgent={meta.byAgent} />
          <span>{meta.source}</span>
          <span>· {t(`confidenceOf.${meta.confidence}`)}</span>
          {pdfSource && meta.page ? (
            <a
              href={`${pdfSource.href}#page=${meta.page}`}
              target="_blank"
              rel="noreferrer"
              className="text-link hover:underline"
            >
              {t("product.openSource")}
            </a>
          ) : null}
        </div>
      ) : null}
      {meta?.sensitive.length && !isEmptyValue(value) ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="warning" icon={ShieldAlert}>
            {t("badges.sensitiveClaims", {
              claims: meta.sensitive.map((k) => t(`claims.${k}`)).join(", "),
            })}
          </Badge>
          {pendingSensitive ? (
            <ConfirmDialog
              title={t("review.acceptFieldTitle", { field: label })}
              confirmLabel={t("review.acceptField")}
              onConfirm={(f) =>
                action.run(() =>
                  acceptSensitiveAction({
                    clientId: data.clientId,
                    productId: data.id,
                    field: def.key,
                    note: String(f.get("note") ?? ""),
                  }),
                )
              }
              trigger={(openDialog) => (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={openDialog}
                  disabled={action.pending}
                >
                  {t("review.acceptSensitive")}
                </Button>
              )}
            >
              <p>{t("product.confirmSensitive")}</p>
              <label className="block text-body-sm text-fg">
                {meta.confidence === "low" ? t("noteRequiredLow") : t("noteOptional")}
                <textarea
                  name="note"
                  rows={2}
                  required={meta.confidence === "low"}
                  maxLength={1000}
                  className={cn(textareaClass, "mt-1")}
                />
              </label>
            </ConfirmDialog>
          ) : (
            <span className="text-body-sm text-fg-muted">{t("accepted")}</span>
          )}
        </div>
      ) : null}
      {proposals.map((p) => (
        <div key={p.id} className="mt-3 rounded-md border border-dashed border-primary p-3">
          <ProposalDiff p={p} clientId={data.clientId} />
        </div>
      ))}
    </div>
  );
}

function FieldValue({ def, value }: { def: FieldDef; value: unknown }) {
  const t = useTranslations("products");
  if (def.kind === "variants")
    return (
      <table className="mt-1 text-body-sm">
        <thead className="text-fg-muted">
          <tr>
            <th scope="col" className="pr-4 text-left font-medium">
              {t("product.attribute")}
            </th>
            <th scope="col" className="pr-4 text-left font-medium">
              {t("product.value")}
            </th>
            <th scope="col" className="text-left font-medium">
              {t("product.variantSku")}
            </th>
          </tr>
        </thead>
        <tbody>
          {(value as ProductVariant[]).map((v, i) => (
            <tr key={i}>
              <td className="pr-4">{v.attribute}</td>
              <td className="pr-4">{v.value}</td>
              <td className="font-mono">{v.sku ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  if (Array.isArray(value))
    return (
      <ul className="mt-1 list-disc pl-5 text-body-md text-fg">
        {value.map((v, i) => (
          <li key={i}>{String(v)}</li>
        ))}
      </ul>
    );
  return (
    <p
      className={cn(
        "mt-1 whitespace-pre-line text-body-md text-fg",
        def.key === "sku" && "font-mono",
      )}
    >
      {String(value)}
    </p>
  );
}

function TruthBadge({ truth, byAgent }: { truth: FieldMetaView["truth"]; byAgent: boolean }) {
  const t = useTranslations("products");
  if (truth === "approved")
    return (
      <Badge variant="success" icon={BadgeCheck}>
        {t("badges.approved")}
      </Badge>
    );
  if (truth === "proposed")
    return (
      <Badge variant="info" icon={byAgent ? Sparkles : User} className="border-dashed">
        {t("badges.proposed")}
      </Badge>
    );
  return (
    <Badge variant="neutral" icon={ScanEye} className="border-dashed">
      {t("badges.observed")}
    </Badge>
  );
}

function ProposalDiff({
  p,
  clientId,
}: {
  p: ProductViewData["proposals"][number];
  clientId: string;
}) {
  const t = useTranslations("products");
  const action = useCatalogAction();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(p.proposed);
  const decide = (decision: "accept" | "reject", editedValue?: unknown) =>
    action.run(() => decideProposalAction({ clientId, proposalId: p.id, decision, editedValue }));
  const def = fieldDefs.find((f) => f.key === p.field);
  return (
    <div className="space-y-2 text-body-sm">
      <p className="font-medium text-fg">
        {p.label} ·{" "}
        <span className="font-normal text-fg-muted">
          {p.source} · {p.when}
        </span>
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-fg-muted">{t("product.currentValue")}</dt>
        <dd className="text-fg">{p.current || "—"}</dd>
        <dt className="text-fg-muted">{t("product.proposedValue")}</dt>
        <dd className="text-fg">{p.proposed || "—"}</dd>
      </dl>
      {p.status === "proposed" ? (
        <>
          {editing && def ? (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              aria-label={t("product.valueToAccept", { field: p.label })}
              className={textareaClass}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={action.pending}
              onClick={() =>
                editing && def
                  ? decide("accept", fromText(def, text.replace(/; /g, "\n")))
                  : decide("accept")
              }
            >
              {t.rich("product.acceptProposal", { field: p.label, hidden })}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={action.pending}
              onClick={() => decide("reject")}
            >
              {t.rich("product.rejectProposal", { field: p.label, hidden })}
            </Button>
            {!editing ? (
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                {t.rich("product.editAndAccept", { field: p.label, hidden })}
              </Button>
            ) : null}
          </div>
          <ActionMessage result={action.result} />
        </>
      ) : (
        <p className="text-fg-muted">
          {p.decidedBy
            ? t("product.proposalStatusBy", { status: p.status, name: p.decidedBy })
            : t("product.proposalStatus", { status: p.status })}
        </p>
      )}
    </div>
  );
}
