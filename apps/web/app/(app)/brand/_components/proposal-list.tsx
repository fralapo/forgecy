"use client";

import { Badge, Button, Input, Label } from "@forgecy/ui";
import { Bot, Check, FileText, Pencil, User, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acceptManyAction, acceptProposalAction, rejectAction } from "../actions";
import { confidenceLabel, confidenceVariant, formatValue } from "../_lib/labels";
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
      if (!r.ok) return setError(r.error ?? "Operazione non riuscita");
      if (r.status === "stale")
        setInfo("Il campo è cambiato dopo la proposta: la proposta è superata.");
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
              aria-label={`Seleziona ${p.title}`}
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
              {p.authorType === "agent" ? "Proposta da " : "Proposta di "}
              {p.author} · {p.createdAt}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={confidenceVariant[p.confidence]}>{confidenceLabel[p.confidence]}</Badge>
          {p.sensitive ? <Badge variant="warning">Sensibile</Badge> : null}
          {p.conflict ? (
            <Badge variant="error">
              In conflitto con altre {p.conflict.size - 1}
              {p.conflict.suggested ? " · fonte più autorevole" : ""}
            </Badge>
          ) : null}
          {p.status !== "proposed" ? <Badge>{p.statusLabel}</Badge> : null}
        </div>
      </header>

      <dl className="grid gap-3 text-body-sm sm:grid-cols-2">
        {p.status === "proposed" ? (
          <div>
            <dt className="text-label text-fg-muted">Ora nella bozza</dt>
            <dd className="mt-1 whitespace-pre-wrap text-fg">{formatValue(p.current)}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-label text-fg-muted">Proposto</dt>
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
        <p className="text-label uppercase text-fg-muted">Fonti</p>
        {p.evidence.length ? (
          <ul className="mt-1 space-y-1 text-body-sm">
            {p.evidence.map((e, i) => (
              <li key={i} className="flex items-start gap-2 text-fg">
                <FileText aria-hidden className="mt-1 size-4 shrink-0 text-fg-muted" />
                <span>
                  {e.title}
                  {e.locator ? `, ${e.locator}` : ""}
                  {e.quote ? <span className="block text-fg-muted">«{e.quote}»</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body-sm text-warning">
            Nessuna fonte indicata: verifica prima di accettare.
          </p>
        )}
      </div>

      {p.review ? (
        <p className="text-body-sm text-fg-muted">
          {p.review.by ? `${p.statusLabel} da ${p.review.by}` : p.statusLabel}
          {p.review.at ? `, ${p.review.at}` : ""}
          {p.review.note ? ` · ${p.review.note}` : ""}
        </p>
      ) : null}

      {reviewable ? (
        <div className="space-y-3 border-t border-subtle pt-4">
          {editing ? (
            typeof p.proposed === "string" ? (
              <div className="space-y-1">
                <Label htmlFor={`edit-${p.id}`}>Valore corretto</Label>
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
              {needsNote
                ? "Nota (obbligatoria: confidenza bassa su un campo sensibile)"
                : "Nota (facoltativa)"}
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
              {editing ? "Accetta con modifiche" : "Accetta"}
            </Button>
            {p.editable && !editing ? (
              <Button variant="secondary" disabled={pending} onClick={() => setEditing(true)}>
                <Pencil aria-hidden />
                Modifica
              </Button>
            ) : null}
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => act(() => rejectAction({ slug, clientId, proposalIds: [p.id], note }))}
            >
              <X aria-hidden />
              Rifiuta
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
      if (!r.ok) return setMessage(r.error ?? "Operazione non riuscita");
      setMessage(
        r.rejected !== undefined
          ? `${r.rejected} proposte rifiutate.`
          : `${r.accepted ?? 0} accettate${r.stale ? `, ${r.stale} superate perché il campo era cambiato` : ""}.`,
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
            {ids.length
              ? `${ids.length} selezionate`
              : "Seleziona le proposte non sensibili per decidere in blocco."}
          </span>
          <Button
            size="sm"
            disabled={!ids.length || pending}
            onClick={() => bulk(() => acceptManyAction({ slug, clientId, proposalIds: ids }))}
          >
            Accetta selezionate
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!ids.length || pending}
            onClick={() => bulk(() => rejectAction({ slug, clientId, proposalIds: ids }))}
          >
            Rifiuta selezionate
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
