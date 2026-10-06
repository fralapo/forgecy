"use client";

import type { ConfidenceLevel, ProductStatus } from "@forgecy/core";
import {
  fieldDefs,
  isEmptyValue,
  LIMITS,
  sectionLabels,
  type FieldDef,
  type FieldKey,
  type ProductFields,
  type ProductVariant,
} from "@forgecy/catalog/fields";
import { claimLabels, type ClaimKind } from "@forgecy/catalog/sensitive";
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
import { useRef, useState } from "react";
import { ActionMessage, ConfirmDialog, useCatalogAction } from "../../_components/client";
import { Banner, Thumb, textareaClass } from "../../_components/ui";
import { fromText, toText } from "../../_lib/field-text";
import { confidenceText } from "../../_lib/labels";
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

const methodLabels: Record<string, string> = {
  folder: "matched by folder",
  filename: "matched by file name",
  sku: "matched by SKU",
  sheet: "listed in the sheet",
  ai: "matched by Brand Analyst",
  manual: "added by hand",
};

type Tab = "sources" | "proposals" | "history" | "usage";

export function ProductView({ data }: { data: ProductViewData }) {
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
    .map((f) => f.label.toLowerCase());
  if (data.images.length === 0) missing.push("images");

  const nextAction = open.length
    ? `you · Accept or reject ${open.length === 1 ? "1 proposed field" : `${open.length} proposed fields`}`
    : data.pendingSensitive.length
      ? `you · Accept ${data.pendingSensitive.length === 1 ? "the sensitive field" : `${data.pendingSensitive.length} sensitive fields`}`
      : missing.length
        ? `you · Fill in the missing fields: ${missing.join(", ")}`
        : data.status === "approved"
          ? "No pending actions"
          : "you · Approve the product";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm text-fg-muted">
          <span className="font-medium text-fg">Next action: </span>
          {nextAction}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {data.status === "draft" || data.status === "proposed" ? (
            <ConfirmDialog
              title={`Approve “${data.name}”?`}
              confirmLabel="Approve product"
              disabled={data.blockers.length > 0}
              onConfirm={(f) => transition("approve", String(f.get("note") ?? ""))}
              trigger={(openDialog) => (
                <Button
                  onClick={openDialog}
                  disabled={action.pending || data.blockers.length > 0}
                  title={data.blockers[0]}
                >
                  <BadgeCheck aria-hidden />
                  Approve product
                </Button>
              )}
            >
              <p>
                The approved description, product sheet and photos become usable in{" "}
                {data.clientName}’s strategy and carousels.
              </p>
              <label className="block text-body-sm text-fg">
                Note (optional)
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
            <Button onClick={() => setTab("proposals")}>Review proposals</Button>
          ) : null}
          {data.status === "rejected" ? (
            <Button onClick={() => transition("to_draft")} disabled={action.pending}>
              Move back to draft
            </Button>
          ) : null}
          {data.status === "archived" ? (
            <Button onClick={() => transition("restore")} disabled={action.pending}>
              Restore product
            </Button>
          ) : null}
          {data.status === "draft" || data.status === "proposed" ? (
            <ConfirmDialog
              title={`Reject “${data.name}”?`}
              confirmLabel="Reject product"
              onConfirm={(f) => transition("reject", String(f.get("note") ?? ""))}
              trigger={(openDialog) => (
                <Button variant="secondary" onClick={openDialog} disabled={action.pending}>
                  Reject product
                </Button>
              )}
            >
              <label className="block text-body-sm text-fg">
                Reason (optional)
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
            Duplicate product
          </Button>
          {data.sourceImportHref ? (
            <Button asChild variant="ghost">
              <Link href={data.sourceImportHref}>Open source import</Link>
            </Button>
          ) : null}
          {data.status !== "archived" ? (
            <ConfirmDialog
              title={`Archive “${data.name}”?`}
              confirmLabel="Archive product"
              danger
              onConfirm={() => transition("archive")}
              trigger={(openDialog) => (
                <Button variant="ghost" onClick={openDialog} disabled={action.pending}>
                  Archive product
                </Button>
              )}
            >
              <p>It can no longer be selected in briefs. Carousels that use it stay unchanged.</p>
            </ConfirmDialog>
          ) : null}
          <ConfirmDialog
            title={`Delete “${data.name}”?`}
            confirmLabel="Delete product"
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
                Delete permanently
              </Button>
            )}
          >
            <p>
              Fields, history and image links are deleted; the images stay in the assets. Type the
              product name to confirm.
            </p>
            <input
              name="typedName"
              required
              aria-label="Product name"
              autoComplete="off"
              className={textareaClass}
            />
          </ConfirmDialog>
        </div>
      </div>
      <ActionMessage result={action.result} />
      {data.status === "draft" && data.blockers.length ? (
        <Banner tone="warning">
          Draft: fill in name, category and short description to approve it.
        </Banner>
      ) : null}
      {data.status === "approved" && action.result?.message === "Saved" ? (
        <Banner tone="warning">
          You edited an approved product. Check the carousels and rubrics that use it.
        </Banner>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <Gallery data={data} onChanged={() => router.refresh()} />
          {(Object.keys(sectionLabels) as FieldDef["section"][]).map((section) => (
            <Section key={section} section={section} data={data} />
          ))}
        </div>
        <aside aria-label="Details" className="space-y-3">
          <div role="tablist" aria-label="Panel" className="flex flex-wrap gap-1">
            {(
              [
                ["sources", "Sources"],
                ["proposals", `Proposals${open.length ? ` (${open.length})` : ""}`],
                ["history", "History"],
                ["usage", "Used in"],
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
                  <li className="text-fg-muted">Created by {data.createdBy}</li>
                ) : null}
                {data.approvedBy ? (
                  <li className="text-fg-muted">
                    Approved by {data.approvedBy} · {data.approvedAt}
                  </li>
                ) : null}
                {data.sources.length === 0 ? (
                  <li className="text-fg-muted">Entered by hand.</li>
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
                <p className="text-body-sm text-fg-muted">No field proposals.</p>
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
              <p className="text-body-sm text-fg-muted">
                No strategy item or carousel uses this product yet.
              </p>
            ) : null}
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Gallery({ data, onChanged }: { data: ProductViewData; onChanged: () => void }) {
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
        setError(body.message ?? `“${file.name}” was not uploaded.`);
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
        <h2 className="text-heading-sm">Photos</h2>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => input.current?.click()}
          disabled={uploading}
        >
          <ImagePlus aria-hidden />
          {uploading ? "Uploading…" : "Add image"}
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
        <p className="text-body-sm text-fg-muted">No linked images.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-4">
          {data.images.map((i) => (
            <li key={i.id} className="space-y-2">
              <Thumb url={i.url} alt={i.alt} size="lg" />
              <div className="flex flex-wrap gap-1">
                {i.isPrimary ? <Badge variant="info">Primary</Badge> : null}
                <Badge variant={i.status === "approved" ? "success" : "neutral"}>
                  {i.status === "approved" ? "Approved" : "Draft"}
                </Badge>
              </div>
              <p className="text-body-sm text-fg-muted">
                {i.fileName} · {methodLabels[i.method] ?? i.method}
                {i.method === "ai" ? ` · ${confidenceText[i.confidence]} confidence` : ""}
              </p>
              {i.status === "draft" ? (
                <p className="text-body-sm text-fg-muted">Approve it to use it in carousels.</p>
              ) : null}
              <div className="flex flex-wrap gap-1">
                {i.status === "draft" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => img(i.id, "approve")}
                    disabled={action.pending}
                  >
                    Approve
                  </Button>
                ) : null}
                {!i.isPrimary ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => img(i.id, "primary")}
                    disabled={action.pending}
                  >
                    Set as primary
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => img(i.id, "unlink")}
                  disabled={action.pending}
                >
                  Unlink
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
  const defs = fieldDefs.filter((f) => f.section === section);
  const empty = defs.every((f) => isEmptyValue(data.fields[f.key]));
  const body = (
    <div className="space-y-4">
      {section === "specs" && empty ? (
        <p className="text-body-sm text-fg-muted">
          Add ingredients or materials, formats and usage instructions: the Copywriter uses them to
          describe the product.
        </p>
      ) : null}
      {section === "commercial" ? (
        <p className="text-body-sm text-fg-muted">
          The Copywriter uses the price only if it is in this approved product and the brief asks
          for it.
        </p>
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
            {sectionLabels[section]}
            {empty ? (
              <span className="ml-2 text-body-sm text-fg-muted">No commercial data</span>
            ) : null}
          </summary>
          <div className="mt-4">{body}</div>
        </details>
      </Card>
    );
  return (
    <Card>
      <h2 className="text-heading-sm">{sectionLabels[section]}</h2>
      {body}
    </Card>
  );
}

function FieldRow({ def, data }: { def: FieldDef; data: ProductViewData }) {
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
          {def.label}
          {def.kind === "list" || def.kind === "tags" ? (
            <span className="ml-1 font-normal text-fg-muted">(one item per line)</span>
          ) : null}
          {def.kind === "variants" ? (
            <span className="ml-1 font-normal text-fg-muted">
              (attribute | value | SKU, one per line)
            </span>
          ) : null}
        </label>
        {!editing ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit<span className="sr-only"> {def.label}</span>
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
              placeholder={def.placeholder}
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
              {action.pending ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : isEmptyValue(value) ? (
        <p className="mt-1 text-body-sm text-fg-muted">{def.placeholder ?? "—"}</p>
      ) : (
        <FieldValue def={def} value={value} />
      )}
      <ActionMessage result={action.result} />
      {meta && !isEmptyValue(value) ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-body-sm text-fg-muted">
          <TruthBadge truth={meta.truth} byAgent={meta.source.startsWith("Proposed by")} />
          <span>{meta.source}</span>
          <span>· {confidenceText[meta.confidence]} confidence</span>
          {pdfSource && meta.page ? (
            <a
              href={`${pdfSource.href}#page=${meta.page}`}
              target="_blank"
              rel="noreferrer"
              className="text-link hover:underline"
            >
              Open source
            </a>
          ) : null}
        </div>
      ) : null}
      {meta?.sensitive.length && !isEmptyValue(value) ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="warning" icon={ShieldAlert}>
            Sensitive · {meta.sensitive.map((k) => claimLabels[k]).join(", ")}
          </Badge>
          {pendingSensitive ? (
            <ConfirmDialog
              title={`Accept “${def.label}”?`}
              confirmLabel="Accept field"
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
                  Accept sensitive field
                </Button>
              )}
            >
              <p>Confirm that the value is correct and can be used in content.</p>
              <label className="block text-body-sm text-fg">
                Note {meta.confidence === "low" ? "(required: Low confidence)" : "(optional)"}
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
            <span className="text-body-sm text-fg-muted">Accepted</span>
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
  if (def.kind === "variants")
    return (
      <table className="mt-1 text-body-sm">
        <thead className="text-fg-muted">
          <tr>
            <th scope="col" className="pr-4 text-left font-medium">
              Attribute
            </th>
            <th scope="col" className="pr-4 text-left font-medium">
              Value
            </th>
            <th scope="col" className="text-left font-medium">
              Variant SKU
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
  if (truth === "approved")
    return (
      <Badge variant="success" icon={BadgeCheck}>
        Approved
      </Badge>
    );
  if (truth === "proposed")
    return (
      <Badge variant="info" icon={byAgent ? Sparkles : User} className="border-dashed">
        Proposed
      </Badge>
    );
  return (
    <Badge variant="neutral" icon={ScanEye} className="border-dashed">
      Extracted, not reviewed
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
        <dt className="text-fg-muted">Current value</dt>
        <dd className="text-fg">{p.current || "—"}</dd>
        <dt className="text-fg-muted">Proposed value</dt>
        <dd className="text-fg">{p.proposed || "—"}</dd>
      </dl>
      {p.status === "proposed" ? (
        <>
          {editing && def ? (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              aria-label={`Value to accept for ${p.label}`}
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
              Accept<span className="sr-only"> {p.label}</span>
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={action.pending}
              onClick={() => decide("reject")}
            >
              Reject<span className="sr-only"> {p.label}</span>
            </Button>
            {!editing ? (
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Edit and accept<span className="sr-only"> {p.label}</span>
              </Button>
            ) : null}
          </div>
          <ActionMessage result={action.result} />
        </>
      ) : (
        <p className="text-fg-muted">
          {p.status === "accepted"
            ? "Accepted"
            : p.status === "rejected"
              ? "Rejected"
              : "Superseded"}
          {p.decidedBy ? ` by ${p.decidedBy}` : ""}
        </p>
      )}
    </div>
  );
}
