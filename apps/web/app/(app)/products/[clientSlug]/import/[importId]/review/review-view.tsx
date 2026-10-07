"use client";

import type { ConfidenceLevel, ImportItemStatus, ProductStatus } from "@forgecy/core";
import {
  fieldDefs,
  formatValue,
  isEmptyValue,
  sameValue,
  type FieldDef,
  type FieldKey,
  type ProductFields,
} from "@forgecy/catalog/fields";
import type { ClaimKind } from "@forgecy/catalog/sensitive";
import { Badge, Button, Card, cn } from "@forgecy/ui";
import { ShieldAlert, Sparkles } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { ActionMessage, ConfirmDialog, useCatalogAction } from "../../../../_components/client";
import {
  ConfidenceBadge,
  EmptyState,
  ObservedBadge,
  ProductStatusBadge,
  Thumb,
  selectClass,
  textareaClass,
} from "../../../../_components/ui";
import { fromText, toText } from "../../../../_lib/field-text";
import { fieldLabel } from "../../../../_lib/labels";
import {
  acceptItemSensitiveAction,
  approveItemsAction,
  closeReviewAction,
  discardPendingAction,
  editItemAction,
  imageDecisionAction,
  itemAction,
} from "./actions";
import { Inbox } from "lucide-react";

type Tab = "new" | "duplicates" | "conflicts" | "images" | "discarded";

export interface ReviewItemView {
  id: string;
  tab: Exclude<Tab, "images">;
  status: ImportItemStatus;
  name: string;
  sku: string | null;
  category: string | null;
  confidence: ConfidenceLevel;
  sensitive: boolean;
  byAgent: boolean;
  origin: string;
  fields: ProductFields;
  meta: Partial<
    Record<
      string,
      | {
          truth: string;
          confidence: ConfidenceLevel;
          source: string;
          sensitive: ClaimKind[];
          accepted: boolean;
        }
      | undefined
    >
  >;
  pendingSensitive: FieldKey[];
  blockers: string[];
  images: Array<{
    fileId: string;
    name: string;
    url: string | null;
    method: string;
    confidence: ConfidenceLevel;
  }>;
  match: {
    id: string;
    name: string;
    status: ProductStatus;
    fields: ProductFields;
    approvedBy: string | null;
    approvedAt: string | null;
    href: Route;
  } | null;
  matchReason: string | null;
  conflicts: Array<{ field: string; approved: unknown; incoming: unknown }>;
  decisions: Record<string, string>;
  discardReason: string | null;
  productHref: Route | null;
}

export interface ReviewImageView {
  id: string;
  name: string;
  url: string | null;
  suggestion: { itemId: string; name: string; confidence: ConfidenceLevel } | null;
}

const tabs: Tab[] = ["new", "duplicates", "conflicts", "images", "discarded"];

export function ReviewView(props: {
  clientId: string;
  clientName: string;
  clientSlug: string;
  importId: string;
  open: boolean;
  items: ReviewItemView[];
  images: ReviewImageView[];
  initialTab: Tab;
  initialItem: string | null;
  discardsHref: string;
  importHref: Route;
  catalogHref: Route;
}) {
  const t = useTranslations("products");
  const [tab, setTab] = useState<Tab>(props.initialTab);
  const [confidence, setConfidence] = useState<"" | ConfidenceLevel>("");
  const [onlySensitive, setOnlySensitive] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(props.initialItem);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const action = useCatalogAction();
  const ids = { clientId: props.clientId, importId: props.importId };

  const counts = useMemo(() => {
    const c: Record<Tab, number> = {
      new: 0,
      duplicates: 0,
      conflicts: 0,
      images: props.images.length,
      discarded: 0,
    };
    for (const i of props.items) c[i.tab]++;
    return c;
  }, [props.items, props.images.length]);
  const list = props.items.filter(
    (i) =>
      i.tab === tab &&
      (!confidence || i.confidence === confidence) &&
      (!onlySensitive || i.sensitive),
  );
  const selected = props.items.find((i) => i.id === selectedId && i.tab === tab) ?? list[0] ?? null;
  const openMatches = props.items.filter((i) => i.status === "pending" && i.match);
  const pendingNew = props.items.filter((i) => i.status === "pending" && !i.match).length;
  const approved = props.items.filter((i) => i.status === "approved").length;
  const chosen = list.filter((i) => checked.has(i.id) && i.status === "pending");
  const chosenSensitive = chosen.filter((i) => i.pendingSensitive.length).length;
  const found = props.items.filter((i) => i.tab !== "discarded").length;

  if (props.items.length === 0 && props.images.length === 0)
    return (
      <Card className="p-0">
        <EmptyState
          icon={Inbox}
          actions={
            <>
              <Button asChild variant="secondary">
                <Link href={props.importHref}>{t("review.backToImport")}</Link>
              </Button>
              <Button asChild variant="secondary">
                <a href={props.discardsHref}>{t("downloadDiscards")}</a>
              </Button>
            </>
          }
        >
          {t("review.nothingFound")}
        </EmptyState>
      </Card>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm text-fg-muted">
          <span className="font-medium text-fg">{t("nextAction")} </span>
          {!props.open
            ? t("noPendingActions")
            : openMatches.length
              ? t("review.nextResolve", {
                  conflicts: counts.conflicts,
                  duplicates: counts.duplicates,
                })
              : t("review.nextApprove")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="ghost">
            <a href={props.discardsHref}>{t("downloadDiscards")}</a>
          </Button>
          <Button asChild variant="ghost">
            <Link href={props.importHref}>{t("review.backToImport")}</Link>
          </Button>
          {props.open ? (
            <>
              <ConfirmDialog
                title={t("review.rejectUndecidedTitle", { count: pendingNew })}
                confirmLabel={t("review.rejectProducts")}
                danger
                disabled={pendingNew === 0}
                onConfirm={() => action.run(() => discardPendingAction(ids))}
                trigger={(open) => (
                  <Button
                    variant="secondary"
                    onClick={open}
                    disabled={action.pending || pendingNew === 0}
                  >
                    {t("review.rejectUndecided")}
                  </Button>
                )}
              >
                <p>{t("review.rejectUndecidedBody")}</p>
              </ConfirmDialog>
              <ConfirmDialog
                title={t("review.closeTitle")}
                confirmLabel={t("review.close")}
                onConfirm={() => action.run(() => closeReviewAction(ids))}
                trigger={(open) => (
                  <Button
                    onClick={open}
                    disabled={action.pending || openMatches.length > 0}
                    title={openMatches.length ? t("review.decideFirst") : undefined}
                  >
                    {t("review.close")}
                  </Button>
                )}
              >
                <p>
                  {t("review.closeSummary", {
                    approved,
                    proposed: pendingNew,
                    discarded: counts.discarded,
                    images: counts.images,
                  })}
                </p>
                <p>{t("review.closeBody")}</p>
              </ConfirmDialog>
            </>
          ) : (
            <Button asChild>
              <Link href={props.catalogHref}>{t("openCatalog")}</Link>
            </Button>
          )}
        </div>
      </div>
      <ActionMessage result={action.result} />

      <Card className="gap-3 p-4">
        <p className="text-body-sm text-fg">
          {t("review.counts", {
            found,
            new: counts.new,
            duplicates: counts.duplicates,
            conflicts: counts.conflicts,
            discarded: counts.discarded,
            images: counts.images,
          })}
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-body-sm text-fg-muted">
            {t("review.confidence")}
            <select
              className={selectClass}
              value={confidence}
              onChange={(e) => setConfidence(e.target.value as "" | ConfidenceLevel)}
            >
              <option value="">{t("review.all")}</option>
              <option value="high">{t("confidence.high")}</option>
              <option value="medium">{t("confidence.medium")}</option>
              <option value="low">{t("confidence.low")}</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-body-sm text-fg">
            <input
              type="checkbox"
              checked={onlySensitive}
              onChange={(e) => setOnlySensitive(e.target.checked)}
              className="size-4"
            />
            {t("review.onlySensitive")}
          </label>
        </div>
      </Card>

      <div role="tablist" aria-label={t("review.tabs.label")} className="flex flex-wrap gap-1">
        {tabs.map((id) => (
          <Button
            key={id}
            role="tab"
            aria-selected={tab === id}
            variant={tab === id ? "secondary" : "ghost"}
            size="sm"
            onClick={() => {
              setTab(id);
              setChecked(new Set());
            }}
          >
            {t("review.tabs.item", { label: t(`review.tabs.${id}`), count: counts[id] })}
          </Button>
        ))}
      </div>

      {tab === "images" ? (
        <ImagesTab images={props.images} items={props.items} ids={ids} open={props.open} />
      ) : list.length === 0 ? (
        <Card className="p-0">
          <EmptyState icon={Inbox}>{t(`review.empty.${tab}`)}</EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <Card className="gap-0 p-0" role="tabpanel">
            {tab === "new" && props.open ? (
              <div
                className="flex flex-wrap items-center gap-2 border-b border-subtle px-4 py-3"
                aria-live="polite"
              >
                <span className="text-body-sm text-fg-muted">
                  {chosen.length
                    ? t("review.selectedCount", { count: chosen.length })
                    : t("review.selectToApprove")}
                </span>
                <ConfirmDialog
                  title={t("review.approveTitle", { count: chosen.length - chosenSensitive })}
                  confirmLabel={t("approve")}
                  disabled={chosen.length - chosenSensitive === 0}
                  onConfirm={() =>
                    action.run(
                      () => approveItemsAction({ ...ids, itemIds: chosen.map((i) => i.id) }),
                      (r) => r.ok && setChecked(new Set()),
                    )
                  }
                  trigger={(open) => (
                    <Button size="sm" onClick={open} disabled={!chosen.length || action.pending}>
                      {t("review.approveSelected")}
                    </Button>
                  )}
                >
                  <p>{t("usableInCarousels", { client: props.clientName })}</p>
                  {chosenSensitive ? (
                    <p>{t("review.sensitiveSkipped", { count: chosenSensitive })}</p>
                  ) : null}
                </ConfirmDialog>
              </div>
            ) : null}
            <ul className="divide-y divide-subtle">
              {list.map((i) => (
                <li
                  key={i.id}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3",
                    selected?.id === i.id && "bg-app",
                  )}
                >
                  {tab === "new" && props.open ? (
                    <input
                      type="checkbox"
                      aria-label={t("selectItem", { name: i.name })}
                      disabled={i.status !== "pending"}
                      checked={checked.has(i.id)}
                      onChange={() =>
                        setChecked((s) => {
                          const n = new Set(s);
                          if (n.has(i.id)) n.delete(i.id);
                          else n.add(i.id);
                          return n;
                        })
                      }
                      className="size-4"
                    />
                  ) : null}
                  <Thumb url={i.images[0]?.url ?? null} alt={i.name} />
                  <button
                    type="button"
                    onClick={() => setSelectedId(i.id)}
                    aria-current={selected?.id === i.id ? "true" : undefined}
                    className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    <span className="block truncate text-body-md text-fg">
                      {i.name || t("untitled")}
                    </span>
                    <span className="block truncate text-body-sm text-fg-muted">
                      {[i.sku, i.category, i.origin].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                  <div className="flex flex-col items-end gap-1">
                    {i.sensitive ? (
                      <ShieldAlert
                        aria-label={t("review.sensitiveFields")}
                        className="size-4 text-warning"
                      />
                    ) : null}
                    <span className="text-body-sm text-fg-muted">
                      {t(`itemStatus.${i.status}`)}
                    </span>
                    {tab !== "discarded" ? (
                      <span className="text-body-sm text-fg-muted">
                        {t(`confidenceOf.${i.confidence}`)}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          {selected ? (
            <ItemDetail key={selected.id} item={selected} ids={ids} open={props.open} />
          ) : null}
        </div>
      )}
    </div>
  );
}

function ItemDetail({
  item,
  ids,
  open,
}: {
  item: ReviewItemView;
  ids: { clientId: string; importId: string };
  open: boolean;
}) {
  const t = useTranslations("products");
  const action = useCatalogAction();
  const [replace, setReplace] = useState<Set<FieldKey>>(new Set());
  const run = (a: Parameters<typeof itemAction>[0]["action"]) =>
    action.run(() => itemAction({ ...ids, itemId: item.id, action: a }));
  const pending = item.status === "pending";
  const diffs = item.match
    ? fieldDefs.filter(
        (d) =>
          !isEmptyValue(item.fields[d.key]) &&
          !sameValue(item.fields[d.key], item.match!.fields[d.key]),
      )
    : [];

  return (
    <Card className="gap-4" aria-label={t("review.detailsOf", { name: item.name })}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-heading-sm">{item.name || t("untitled")}</h2>
          <p className="text-body-sm text-fg-muted">{item.origin}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {item.byAgent ? (
            <Badge variant="info" icon={Sparkles}>
              {t("proposedByAgent")}
            </Badge>
          ) : null}
          <ConfidenceBadge level={item.confidence} />
        </div>
      </div>
      {item.productHref ? (
        <Link href={item.productHref} className="text-body-sm text-link hover:underline">
          {t("review.openProduct")}
        </Link>
      ) : null}
      {item.discardReason ? (
        <p className="text-body-sm text-fg-muted">
          {t("review.reason", { reason: item.discardReason })}
        </p>
      ) : null}

      {item.images.length ? (
        <ul className="grid grid-cols-3 gap-2">
          {item.images.map((img) => (
            <li key={img.fileId} className="space-y-1">
              <Thumb url={img.url} alt={item.name} size="lg" />
              <span className="block truncate text-body-sm text-fg-muted">{img.name}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {item.tab === "conflicts" && item.match ? (
        <div className="space-y-3">
          {item.conflicts.map((c) => {
            const def = fieldDefs.find((d) => d.key === c.field);
            const decision = item.decisions[c.field];
            return (
              <div key={c.field} className="rounded-md border border-subtle p-3 text-body-sm">
                <p className="font-medium text-fg">{def ? fieldLabel(t, def.key) : c.field}</p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="text-fg-muted">{t("review.approvedValue")}</dt>
                  <dd>
                    {formatValue(c.field as FieldKey, c.approved) || "—"}
                    {item.match!.approvedBy ? (
                      <span className="block text-fg-muted">
                        {item.match!.approvedAt
                          ? t("review.approvedByOn", {
                              name: item.match!.approvedBy,
                              date: item.match!.approvedAt,
                            })
                          : t("review.approvedBy", { name: item.match!.approvedBy })}
                      </span>
                    ) : null}
                  </dd>
                  <dt className="text-fg-muted">{t("review.fromFile")}</dt>
                  <dd>
                    {formatValue(c.field as FieldKey, c.incoming) || "—"}
                    <span className="block text-fg-muted">
                      {item.meta[c.field]?.source ?? item.origin}
                    </span>
                  </dd>
                </dl>
                {decision ? (
                  <p className="mt-2 text-fg-muted">
                    {decision === "keep"
                      ? t("review.decided.keep")
                      : decision === "accept"
                        ? t("review.decided.accept")
                        : t("review.decided.defer")}
                  </p>
                ) : open && pending ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={action.pending}
                      onClick={() =>
                        run({ type: "conflict", field: c.field as FieldKey, decision: "keep" })
                      }
                    >
                      {t("review.keepApproved")}
                    </Button>
                    <Button
                      size="sm"
                      disabled={action.pending}
                      onClick={() =>
                        run({ type: "conflict", field: c.field as FieldKey, decision: "accept" })
                      }
                    >
                      {t("review.acceptFileValue")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={action.pending}
                      onClick={() =>
                        run({ type: "conflict", field: c.field as FieldKey, decision: "defer" })
                      }
                    >
                      {t("review.defer")}
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
          <Link href={item.match.href} className="text-body-sm text-link hover:underline">
            {t("review.openInCatalog")}
          </Link>
        </div>
      ) : null}

      {item.tab === "duplicates" && item.match ? (
        <div className="space-y-3 text-body-sm">
          <p className="text-fg-muted">
            {t("review.inCatalog", { reason: item.matchReason ?? t("matchReasons.possible") })}{" "}
            <Link href={item.match.href} className="text-link hover:underline">
              {item.match.name}
            </Link>{" "}
            <ProductStatusBadge status={item.match.status} />
          </p>
          {diffs.length === 0 ? (
            <p className="text-fg-muted">{t("review.noDifferences")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="text-left text-fg-muted">
                  <tr>
                    {open && pending ? (
                      <th scope="col">
                        <span className="sr-only">{t("review.replace")}</span>
                      </th>
                    ) : null}
                    <th scope="col" className="font-medium">
                      {t("review.field")}
                    </th>
                    <th scope="col" className="font-medium">
                      {t("review.catalogValue")}
                    </th>
                    <th scope="col" className="font-medium">
                      {t("review.fromFile")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {diffs.map((d) => (
                    <tr key={d.key} className="border-t border-subtle align-top">
                      {open && pending ? (
                        <td className="py-1 pr-2">
                          <input
                            type="checkbox"
                            aria-label={t("review.replaceField", { field: fieldLabel(t, d.key) })}
                            checked={replace.has(d.key)}
                            onChange={() =>
                              setReplace((s) => {
                                const n = new Set(s);
                                if (n.has(d.key)) n.delete(d.key);
                                else n.add(d.key);
                                return n;
                              })
                            }
                            className="size-4"
                          />
                        </td>
                      ) : null}
                      <td className="py-1 pr-2 text-fg-muted">{fieldLabel(t, d.key)}</td>
                      <td className="py-1 pr-2">
                        {formatValue(d.key, item.match!.fields[d.key]) || "—"}
                      </td>
                      <td className="py-1 font-medium">{formatValue(d.key, item.fields[d.key])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {open && pending ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={action.pending} onClick={() => run({ type: "merge" })}>
                {t("review.merge")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={action.pending}
                onClick={() => run({ type: "keep_both" })}
              >
                {t("review.keepBoth")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={action.pending || replace.size === 0}
                onClick={() => run({ type: "replace_fields", fields: [...replace] })}
              >
                {t("review.replaceSelected")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {item.tab === "new" || item.tab === "discarded" ? (
        <div className="space-y-3">
          {fieldDefs
            .filter(
              (d) =>
                !isEmptyValue(item.fields[d.key]) ||
                ["name", "category", "shortDescription"].includes(d.key),
            )
            .map((d) => (
              <ItemField key={d.key} def={d} item={item} ids={ids} editable={open && pending} />
            ))}
        </div>
      ) : null}

      <ActionMessage result={action.result} />
      {open ? (
        <div className="flex flex-wrap gap-2 border-t border-subtle pt-3">
          {item.tab === "new" && pending ? (
            <>
              <Button
                size="sm"
                disabled={action.pending || item.blockers.length > 0}
                title={item.blockers[0]}
                onClick={() => run({ type: "approve" })}
              >
                {t("approve")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={action.pending}
                onClick={() => run({ type: "accept" })}
              >
                {t("review.acceptAsProposed")}
              </Button>
            </>
          ) : null}
          {item.tab !== "discarded" && pending ? (
            <ConfirmDialog
              title={t("review.rejectTitle", { name: item.name })}
              confirmLabel={t("reject")}
              onConfirm={(f) =>
                run({ type: "discard", reason: String(f.get("reason") ?? "") || undefined })
              }
              trigger={(openDialog) => (
                <Button size="sm" variant="ghost" onClick={openDialog} disabled={action.pending}>
                  {t("reject")}
                </Button>
              )}
            >
              <label className="block text-body-sm text-fg">
                {t("reasonOptional")}
                <input name="reason" maxLength={500} className={cn(textareaClass, "mt-1")} />
              </label>
            </ConfirmDialog>
          ) : null}
          {item.tab === "discarded" ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={action.pending}
              onClick={() => run({ type: "recover" })}
            >
              {t("review.recover")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function ItemField({
  def,
  item,
  ids,
  editable,
}: {
  def: FieldDef;
  item: ReviewItemView;
  ids: { clientId: string; importId: string };
  editable: boolean;
}) {
  const t = useTranslations("products");
  const value = item.fields[def.key];
  const meta = item.meta[def.key];
  const label = fieldLabel(t, def.key);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(() => toText(def, value));
  const action = useCatalogAction();
  const needsAccept = item.pendingSensitive.includes(def.key);
  return (
    <div className="border-b border-subtle pb-3 text-body-sm last:border-0">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-fg">{label}</span>
        {editable && !editing ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            {t("edit")}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="mt-1 space-y-2">
          <textarea
            aria-label={label}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={def.kind === "text" ? 1 : 3}
            className={textareaClass}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={action.pending}
              onClick={() =>
                action.run(
                  () =>
                    editItemAction({
                      ...ids,
                      itemId: item.id,
                      field: def.key,
                      value: fromText(def, text),
                    }),
                  (r) => r.ok && setEditing(false),
                )
              }
            >
              {t("save")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-1 whitespace-pre-line text-fg">{formatValue(def.key, value) || "—"}</p>
      )}
      {meta && !isEmptyValue(value) ? (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-fg-muted">
          {meta.truth === "observed" ? <ObservedBadge /> : null}
          {t("review.metaSource", {
            source: meta.source,
            confidence: t(`confidenceOf.${meta.confidence}`),
          })}
        </p>
      ) : null}
      {meta?.sensitive.length && !isEmptyValue(value) ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Badge variant="warning" icon={ShieldAlert}>
            {t("badges.sensitiveClaims", {
              claims: meta.sensitive.map((k) => t(`claims.${k}`)).join(", "),
            })}
          </Badge>
          {needsAccept && editable ? (
            <ConfirmDialog
              title={t("review.acceptFieldTitle", { field: label })}
              confirmLabel={t("review.acceptField")}
              onConfirm={(f) =>
                action.run(() =>
                  acceptItemSensitiveAction({
                    ...ids,
                    itemId: item.id,
                    field: def.key,
                    note: String(f.get("note") ?? "") || undefined,
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
          ) : !needsAccept ? (
            <span className="text-fg-muted">{t("accepted")}</span>
          ) : null}
        </div>
      ) : null}
      <ActionMessage result={action.result} />
    </div>
  );
}

function ImagesTab({
  images,
  items,
  ids,
  open,
}: {
  images: ReviewImageView[];
  items: ReviewItemView[];
  ids: { clientId: string; importId: string };
  open: boolean;
}) {
  const t = useTranslations("products");
  const action = useCatalogAction();
  const targets = items.filter((i) => i.tab !== "discarded" && i.name);
  if (images.length === 0)
    return (
      <Card className="p-0">
        <EmptyState icon={Inbox}>{t("review.empty.images")}</EmptyState>
      </Card>
    );
  return (
    <Card role="tabpanel">
      <ActionMessage result={action.result} />
      <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-4">
        {images.map((img) => (
          <li key={img.id} className="space-y-2">
            <Thumb url={img.url} alt={img.name} size="lg" />
            <p className="truncate text-body-sm text-fg">{img.name}</p>
            {img.suggestion ? (
              <p className="text-body-sm text-fg-muted">
                {t("review.maybe", {
                  name: img.suggestion.name,
                  confidence: t(`confidence.${img.suggestion.confidence}`),
                })}
              </p>
            ) : null}
            {open ? (
              <div className="space-y-2">
                {img.suggestion ? (
                  <Button
                    size="sm"
                    disabled={action.pending}
                    onClick={() =>
                      action.run(() =>
                        imageDecisionAction({
                          ...ids,
                          fileId: img.id,
                          action: "accept_suggestion",
                        }),
                      )
                    }
                  >
                    {t("review.acceptSuggestion")}
                  </Button>
                ) : null}
                <select
                  aria-label={t("review.assignTo", { name: img.name })}
                  className={cn(selectClass, "w-full")}
                  defaultValue=""
                  disabled={action.pending}
                  onChange={(e) =>
                    e.target.value &&
                    action.run(() =>
                      imageDecisionAction({
                        ...ids,
                        fileId: img.id,
                        action: "assign",
                        itemId: e.target.value,
                      }),
                    )
                  }
                >
                  <option value="">{t("review.assignPlaceholder")}</option>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.sku ? ` (${t.sku})` : ""}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={action.pending}
                  onClick={() =>
                    action.run(() =>
                      imageDecisionAction({ ...ids, fileId: img.id, action: "ignore" }),
                    )
                  }
                >
                  {t("review.ignoreImage")}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
