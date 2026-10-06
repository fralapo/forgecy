"use client";

import { Badge, Button, cn, Input, Label } from "@forgecy/ui";
import { Bot, Check, Pencil, Plus, Sparkles, User, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addCompetitorAction,
  editCompetitorAction,
  requestCompetitorProposalAction,
  reviewCompetitorAction,
} from "../actions";
import { levelLabel, sourceStatusLabel, sourceStatusVariant } from "../_lib/labels";
import type { Level, SourceStatus } from "@forgecy/core";

export interface CompetitorView {
  id: string;
  name: string;
  websiteUrl: string | null;
  reason: string | null;
  confidence: Level;
  proposedByAgent: string | null;
  status: "proposed" | "confirmed" | "removed";
  removedReason: string | null;
  sourceStatus: SourceStatus;
  sourceError: string | null;
}

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) return setError(res.error ?? "Operazione non riuscita");
      after?.();
      router.refresh();
    });
  return { pending, error, run };
}

export function CompetitorItem({ c, readOnly }: { c: CompetitorView; readOnly: boolean }) {
  const { pending, error, run } = useRun();
  const [mode, setMode] = useState<"view" | "remove" | "edit">("view");
  const isAi = Boolean(c.proposedByAgent);
  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-lg bg-surface p-4",
        isAi && c.status === "proposed"
          ? "border-2 border-dashed border-primary"
          : "border border-subtle",
        c.status === "removed" && "opacity-70",
      )}
    >
      {mode === "edit" ? (
        <CompetitorForm
          initial={c}
          pending={pending}
          onCancel={() => setMode("view")}
          onSave={(v) =>
            run(
              () => editCompetitorAction(c.id, v),
              () => setMode("view"),
            )
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-heading-sm text-fg">{c.name}</p>
              {c.websiteUrl ? (
                <a
                  href={c.websiteUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-body-sm text-link underline-offset-2 hover:underline"
                >
                  {c.websiteUrl}
                </a>
              ) : (
                <p className="text-body-sm text-fg-muted">Nessun sito</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge
                variant={
                  c.status === "confirmed"
                    ? "success"
                    : c.status === "removed"
                      ? "neutral"
                      : "highlight"
                }
              >
                {c.status === "confirmed"
                  ? "Confermato"
                  : c.status === "removed"
                    ? "Rimosso"
                    : "Da confermare"}
              </Badge>
              {c.status !== "removed" ? (
                <Badge variant={sourceStatusVariant[c.sourceStatus]}>
                  Sito: {sourceStatusLabel[c.sourceStatus].toLowerCase()}
                </Badge>
              ) : null}
            </div>
          </div>
          <p className="flex items-center gap-1 text-body-sm text-fg-muted">
            {isAi ? (
              <Bot aria-hidden className="size-4" />
            ) : (
              <User aria-hidden className="size-4" />
            )}
            {isAi
              ? `Proposto dallo Strategist · confidenza ${levelLabel[c.confidence].toLowerCase()}`
              : "Aggiunto da una persona"}
          </p>
          {c.reason ? <p className="text-body-sm">{c.reason}</p> : null}
          {c.removedReason ? (
            <p className="text-body-sm text-fg-muted">Motivo: {c.removedReason}</p>
          ) : null}
          {c.sourceError ? <p className="text-body-sm text-fg-muted">{c.sourceError}</p> : null}
        </>
      )}
      {mode === "remove" ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
            run(
              () => reviewCompetitorAction({ id: c.id, decision: "remove", reason }),
              () => setMode("view"),
            );
          }}
        >
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-label text-fg-muted">
            Perché lo rimuovi?
            <Input name="reason" required maxLength={200} placeholder="Es. settore diverso" />
          </label>
          <Button type="submit" variant="danger" size="sm" disabled={pending}>
            Rimuovi
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setMode("view")}>
            Annulla
          </Button>
        </form>
      ) : null}
      {!readOnly && mode === "view" ? (
        <div className="flex flex-wrap gap-2">
          {c.status !== "confirmed" ? (
            <Button
              size="sm"
              disabled={pending}
              onClick={() => run(() => reviewCompetitorAction({ id: c.id, decision: "confirm" }))}
            >
              <Check aria-hidden />
              Conferma
            </Button>
          ) : null}
          {c.status !== "removed" ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => setMode("remove")}
            >
              <X aria-hidden />
              Rimuovi
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => setMode("edit")}>
            <Pencil aria-hidden />
            Modifica
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function CompetitorForm({
  initial,
  pending,
  onCancel,
  onSave,
}: {
  initial?: Pick<CompetitorView, "name" | "websiteUrl" | "reason">;
  pending: boolean;
  onCancel: () => void;
  onSave: (v: { name: string; websiteUrl?: string; reason?: string }) => void;
}) {
  const key = initial?.name ?? "new";
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const v = (k: string) => String(f.get(k) ?? "").trim();
        onSave({
          name: v("name"),
          ...(v("websiteUrl") ? { websiteUrl: v("websiteUrl") } : {}),
          ...(v("reason") ? { reason: v("reason") } : {}),
        });
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`c-name-${key}`}>Nome</Label>
          <Input
            id={`c-name-${key}`}
            name="name"
            required
            maxLength={120}
            defaultValue={initial?.name ?? ""}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`c-url-${key}`}>Sito</Label>
          <Input
            id={`c-url-${key}`}
            name="websiteUrl"
            inputMode="url"
            defaultValue={initial?.websiteUrl ?? ""}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`c-reason-${key}`}>Perché è un competitor</Label>
        <Input
          id={`c-reason-${key}`}
          name="reason"
          maxLength={300}
          defaultValue={initial?.reason ?? ""}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          Salva
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Annulla
        </Button>
      </div>
    </form>
  );
}

export function AddCompetitor({ auditId }: { auditId: string }) {
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      {open ? (
        <CompetitorForm
          pending={pending}
          onCancel={() => setOpen(false)}
          onSave={(v) =>
            run(
              () => addCompetitorAction(auditId, v),
              () => setOpen(false),
            )
          }
        />
      ) : (
        <div>
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            <Plus aria-hidden />
            Aggiungi competitor
          </Button>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ProposalRequest({
  auditId,
  hasProposals,
}: {
  auditId: string;
  hasProposals: boolean;
}) {
  const { pending, error, run } = useRun();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const instruction = String(new FormData(e.currentTarget).get("instruction") ?? "").trim();
        run(() => requestCompetitorProposalAction(auditId, instruction || undefined));
      }}
    >
      <label className="flex min-w-64 flex-1 flex-col gap-1 text-label text-fg-muted">
        Indicazione per lo Strategist (facoltativa)
        <Input name="instruction" maxLength={500} placeholder="Es. solo aziende della Lombardia" />
      </label>
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        <Sparkles aria-hidden />
        {hasProposals ? "Nuove proposte" : "Proponi competitor"}
      </Button>
      {error ? (
        <p role="alert" className="w-full text-body-sm text-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}
