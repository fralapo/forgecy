"use client";

import { Badge, Button, Input, Label } from "@forgecy/ui";
import { Bot, Check, FileText, Pencil, User, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { acceptManyAction, acceptProposalAction, rejectAction } from "../actions";
import { confidenceVariant, formatValue } from "../_lib/labels";
import { controlClass } from "./section-editor";

export interface ProposalView {
  id: string;
  title: string;
  block: string;
  fieldPath: string;
  status: "proposed" | "accepted" | "rejected" | "stale";
  statusLabel: string;
  author: string;
  authorType: "user" | "agent";
  createdAt: string;
  rationale: string | null;
  proposed: unknown;
  current: unknown;
  editable: boolean;
  confidence: "high" | "medium" | "low";
  confidenceReason: string;
  sensitive: boolean;
  checks: string[];
  evidence: Array<{ title: string; locator: string | null; quote: string | null }>;
  conflict: { suggested: boolean; size: number } | null;
  review: { by: string | null; at: string | null; note: string | null } | null;
}

function ProposalCard({
  p,
  slug,
  clientId,
  reviewable,
  selected,
  onSelect,
}: {
  p: ProposalView;
  slug: string;
  clientId: string;
  reviewable: boolean;
  selected: boolean;
  onSelect(v: boolean): void;
}) {
  const t = useTranslations("brand.proposals");
  const tb = useTranslations("brand");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState<unknown>(p.proposed);
  const needsNote = p.sensitive && p.confidence === "low";

  const act = (fn: () => Promise<{ ok: boolean; error?: string; status?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error ?? t("failed"));
      if (r.status === "stale") setInfo(t("superseded"));
      router.refresh();
    });

  const editedObj =
    typeof edited === "object" && edited !== null ? (edited as Record<string, string>) : {};

  return (
    <article
      aria-labelledby={`p-${p.id}`}
      className={
        p.authorType === "agent"
          ? "space-y-4 rounded-lg border-2 border-dashed border-primary bg-surface p-5"
          : "space-y-4 rounded-lg border-2 border-dashed border-control bg-surface p-5"
      }
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {reviewable && !p.sensitive ? (
            <input
              type="checkbox"
              aria-label={t("select", { title: p.title })}
              checked={selected}
              onChange={(e) => onSelect(e.target.checked)}
              className="mt-2 size-4"
            />
          ) : null}
          <div>
            <p className="text-label uppercase text-fg-muted">{p.block}</p>
            <h3 id={`p-${p.id}`} className="text-heading-sm text-fg">
              {p.title}
            </h3>
            <p className="flex items-center gap-1 text-body-sm text-fg-muted">
              {p.authorType === "agent" ? (
                <Bot aria-hidden className="size-4" />
              ) : (
                <User aria-hidden className="size-4" />
              )}
              {t("proposedBy", { author: p.author, date: p.createdAt })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={confidenceVariant[p.confidence]}>
            {tb(`confidence.${p.confidence}`)}
          </Badge>
          {p.sensitive ? <Badge variant="warning">{t("sensitive")}</Badge> : null}
          {p.conflict ? (
            <Badge variant="error">
              {t(p.conflict.suggested ? "inConflictSuggested" : "inConflict", {
                count: p.conflict.size - 1,
              })}
            </Badge>
          ) : null}
          {p.status !== "proposed" ? <Badge>{p.statusLabel}</Badge> : null}
        </div>
      </header>

      <dl className="grid gap-3 text-body-sm sm:grid-cols-2">
        {p.status === "proposed" ? (
          <div>
            <dt className="text-label text-fg-muted">{t("nowInDraft")}</dt>
            <dd className="mt-1 whitespace-pre-wrap text-fg">{formatValue(p.current)}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-label text-fg-muted">{t("proposed")}</dt>
          <dd className="mt-1 whitespace-pre-wrap text-fg">{formatValue(p.proposed)}</dd>
        </div>
      </dl>
      {p.rationale ? <p className="text-body-sm text-fg">{p.rationale}</p> : null}
      <p className="text-body-sm text-fg-muted">{p.confidenceReason}</p>
      {p.checks.length ? (
        <ul className="space-y-1 text-body-sm text-warning">
          {p.checks.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : null}

      <div>
        <p className="text-label uppercase text-fg-muted">{t("sources")}</p>
        {p.evidence.length ? (
          <ul className="mt-1 space-y-1 text-body-sm">
            {p.evidence.map((e, i) => (
              <li key={i} className="flex items-start gap-2 text-fg">
                <FileText aria-hidden className="mt-1 size-4 shrink-0 text-fg-muted" />
                <span>
                  {e.title}
                  {e.locator ? `, ${e.locator}` : ""}
                  {e.quote ? <span className="block text-fg-muted">“{e.quote}”</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body-sm text-warning">{t("noSource")}</p>
        )}
      </div>

      {p.review ? (
        <p className="text-body-sm text-fg-muted">
          {p.review.by
            ? t("reviewedBy", { status: p.statusLabel, name: p.review.by })
            : p.statusLabel}
          {p.review.at ? `, ${p.review.at}` : ""}
          {p.review.note ? ` · ${p.review.note}` : ""}
        </p>
      ) : null}

      {reviewable ? (
        <div className="space-y-3 border-t border-subtle pt-4">
          {editing ? (
            typeof p.proposed === "string" ? (
              <div className="space-y-1">
                <Label htmlFor={`edit-${p.id}`}>{t("correctedValue")}</Label>
                <textarea
                  id={`edit-${p.id}`}
                  rows={3}
                  className={controlClass}
                  value={String(edited ?? "")}
                  onChange={(e) => setEdited(e.target.value)}
                />
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {Object.keys(p.proposed as object).map((k) => (
                  <div key={k} className="space-y-1">
                    <Label htmlFor={`edit-${p.id}-${k}`}>{k}</Label>
                    <Input
                      id={`edit-${p.id}-${k}`}
                      value={editedObj[k] ?? ""}
                      onChange={(e) => setEdited({ ...editedObj, [k]: e.target.value })}
                    />
                  </div>
                ))}
              </div>
            )
          ) : null}
          <div className="space-y-1">
            <Label htmlFor={`note-${p.id}`}>
              {needsNote ? t("noteRequired") : t("noteOptional")}
            </Label>
            <Input id={`note-${p.id}`} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending || (needsNote && note.trim().length < 10)}
              onClick={() =>
                act(() =>
                  acceptProposalAction({
                    slug,
                    clientId,
                    proposalId: p.id,
                    note,
                    ...(editing ? { editedValue: edited } : {}),
                  }),
                )
              }
            >
              <Check aria-hidden />
              {editing ? t("acceptEdited") : t("accept")}
            </Button>
            {p.editable && !editing ? (
              <Button variant="secondary" disabled={pending} onClick={() => setEditing(true)}>
                <Pencil aria-hidden />
                {t("edit")}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => act(() => rejectAction({ slug, clientId, proposalIds: [p.id], note }))}
            >
              <X aria-hidden />
              {t("reject")}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-body-sm text-error">
              {error}
            </p>
          ) : null}
          {info ? (
            <p role="status" className="text-body-sm text-fg">
              {info}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/** Proposals as cards. Bulk accept covers non-sensitive ones only (sensitive: one by one). */
export function ProposalList({
  slug,
  clientId,
  proposals,
  reviewable,
}: {
  slug: string;
  clientId: string;
  proposals: ProposalView[];
  reviewable: boolean;
}) {
  const t = useTranslations("brand.proposals");
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const bulk = (
    fn: () => Promise<{
      ok: boolean;
      error?: string;
      accepted?: number;
      stale?: number;
      rejected?: number;
    }>,
  ) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setMessage(r.error ?? t("failed"));
      setMessage(
        r.rejected !== undefined
          ? t("rejectedCount", { count: r.rejected })
          : r.stale
            ? t("acceptedWithStale", { count: r.accepted ?? 0, stale: r.stale })
            : t("acceptedCount", { count: r.accepted ?? 0 }),
      );
      setSelected(new Set());
      router.refresh();
    });
  const ids = [...selected];
  return (
    <div className="space-y-4">
      {reviewable ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-subtle bg-surface px-4 py-3">
          <span className="text-body-sm text-fg-muted">
            {ids.length ? t("selected", { count: ids.length }) : t("selectHint")}
          </span>
          <Button
            size="sm"
            disabled={!ids.length || pending}
            onClick={() => bulk(() => acceptManyAction({ slug, clientId, proposalIds: ids }))}
          >
            {t("acceptSelected")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!ids.length || pending}
            onClick={() => bulk(() => rejectAction({ slug, clientId, proposalIds: ids }))}
          >
            {t("rejectSelected")}
          </Button>
          {message ? (
            <span role="status" className="text-body-sm text-fg">
              {message}
            </span>
          ) : null}
        </div>
      ) : null}
      {proposals.map((p) => (
        <ProposalCard
          key={p.id}
          p={p}
          slug={slug}
          clientId={clientId}
          reviewable={reviewable}
          selected={selected.has(p.id)}
          onSelect={(v) =>
            setSelected((s) => {
              const next = new Set(s);
              if (v) next.add(p.id);
              else next.delete(p.id);
              return next;
            })
          }
        />
      ))}
    </div>
  );
}
