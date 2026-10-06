"use client";

import {
  guardBandLabels,
  type ContentCheck,
  type GuardBand,
  type GuardFinding,
} from "@forgecy/content/client";
import { Badge, Button, Label } from "@forgecy/ui";
import { BadgeCheck, MessageSquareWarning, RefreshCw, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { decideAssetAction, decideReviewAction, type ActionResult } from "../actions";
import { ActionButton, controlClass } from "./action-button";
import { Thumb } from "./editor-ai";

const NOTE_MIN = 3;

export interface PendingImage {
  id: string;
  alt: string;
  thumb: string | null;
  source: "upload" | "ai" | "product";
  commercialUse: "verified" | "pending_verification" | "rejected" | null;
}

export interface ReviewGuard {
  band: GuardBand;
  /** Open errors and warnings (notes excluded). */
  findings: GuardFinding[];
  notes: GuardFinding[];
  notRun: Array<{ check: string; reason: string }>;
}

/** Guard findings point at a slide by its position in the carousel (0-based). */
const slideLabel = (slide: number | null) => (slide === null ? "Carosello" : `Slide ${slide + 1}`);

function groupBySlide(findings: GuardFinding[]) {
  const groups = new Map<number | null, GuardFinding[]>();
  for (const f of findings) groups.set(f.slide, [...(groups.get(f.slide) ?? []), f]);
  return [...groups.entries()].sort(([a], [b]) => (a ?? -1) - (b ?? -1));
}

function errorText(r: Extract<ActionResult, { ok: false }>) {
  switch (r.code) {
    case "SELF-APPROVAL-NOTE":
      return "Stai approvando un tuo lavoro: scrivi una nota per chi verrà dopo.";
    case "CHECKS-BLOCKING":
      return "Ci sono problemi bloccanti: vanno risolti prima dell'approvazione.";
    case "CHECKS-UNACKNOWLEDGED":
      return "Conferma «Ho visto» su ogni avviso.";
    case "VERSION-CHANGED":
      return "Il carosello è cambiato dopo l'invio: ricarica la pagina.";
    case "PERM-DENIED":
      return "Non hai il permesso per questa decisione.";
    default:
      return r.error;
  }
}

export function ReviewForm({
  slug,
  clientId,
  contentId,
  versionId,
  versionNumber,
  canApprove,
  canReview,
  selfApproval,
  errors,
  warnings,
  guard,
  pendingImages,
}: {
  slug: string;
  clientId: string;
  contentId: string;
  versionId: string;
  versionNumber: number;
  canApprove: boolean;
  canReview: boolean;
  selfApproval: boolean;
  errors: ContentCheck[];
  warnings: ContentCheck[];
  guard: ReviewGuard | null;
  pendingImages: PendingImage[];
}) {
  const router = useRouter();
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [error, setError] = useState<{
    text: string;
    checks: ContentCheck[];
    reload: boolean;
  } | null>(null);
  const [pending, start] = useTransition();

  const guardBlocking = guard?.findings.filter((f) => f.blocksApproval) ?? [];
  const guardToSee = guard?.findings.filter((f) => !f.blocksApproval) ?? [];
  const toAcknowledge = [...warnings.map((w) => w.id), ...guardToSee.map((f) => f.key)];
  const allSeen = toAcknowledge.every((k) => seen.has(k));
  const blocked = errors.length > 0 || guardBlocking.length > 0;
  const noteOk = note.trim().length >= NOTE_MIN;
  const canSubmitApproval = canApprove && !blocked && allSeen && (!selfApproval || noteOk);

  const toggle = (key: string, on: boolean) =>
    setSeen((s) => {
      const next = new Set(s);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const decide = (decision: "approved" | "changes_requested") =>
    start(async () => {
      setError(null);
      const r = await decideReviewAction({
        slug,
        clientId,
        id: contentId,
        versionId,
        decision,
        note,
        acknowledged: decision === "approved" ? toAcknowledge.filter((k) => seen.has(k)) : [],
      });
      if (!r.ok) {
        const list = Array.isArray(r.details?.checks) ? (r.details.checks as ContentCheck[]) : [];
        return setError({ text: errorText(r), checks: list, reload: r.code === "VERSION-CHANGED" });
      }
      router.refresh();
    });

  const seenBox = (k: string, children: ReactNode) => (
    <li key={k} className="flex items-start gap-3 text-body-sm">
      <input
        id={`seen-${k}`}
        type="checkbox"
        className="mt-1 size-4"
        checked={seen.has(k)}
        onChange={(e) => toggle(k, e.target.checked)}
      />
      <label htmlFor={`seen-${k}`} className="text-fg">
        <span className="text-warning">Ho visto:</span> {children}
      </label>
    </li>
  );

  return (
    <div className="space-y-6">
      {errors.length || guardBlocking.length ? (
        <section className="space-y-2" aria-labelledby="blocking-title">
          <h3 id="blocking-title" className="text-heading-sm text-error">
            Problemi bloccanti
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-body-sm text-fg">
            {errors.map((c) => (
              <li key={c.id}>{c.message}</li>
            ))}
            {guardBlocking.map((f) => (
              <li key={f.key}>
                {slideLabel(f.slide)}: {f.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {pendingImages.length ? (
        <section className="space-y-2" aria-labelledby="images-title">
          <h3 id="images-title" className="text-heading-sm text-fg">
            Immagini da approvare
          </h3>
          <p className="text-body-sm text-fg-muted">
            Il carosello usa immagini non ancora approvate: approvale o rimandalo indietro.
          </p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {pendingImages.map((a) => (
              <li key={a.id} className="space-y-2 rounded-md border border-subtle p-2">
                <Thumb url={a.thumb} alt={a.alt} />
                {a.source === "ai" ? (
                  <Badge variant={a.commercialUse === "verified" ? "success" : "warning"}>
                    {a.commercialUse === "verified"
                      ? "Uso commerciale verificato"
                      : a.commercialUse === "rejected"
                        ? "Uso commerciale rifiutato"
                        : "Uso commerciale da verificare"}
                  </Badge>
                ) : null}
                <div className="flex flex-wrap gap-1">
                  <ActionButton
                    size="sm"
                    action={() =>
                      decideAssetAction({ slug, clientId, id: a.id, decision: "approved" })
                    }
                  >
                    Approva
                  </ActionButton>
                  <ActionButton
                    size="sm"
                    variant="ghost"
                    action={() =>
                      decideAssetAction({ slug, clientId, id: a.id, decision: "rejected" })
                    }
                  >
                    Rifiuta
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-2" aria-labelledby="warnings-title">
        <h3 id="warnings-title" className="text-heading-sm text-fg">
          Controlli del modulo
        </h3>
        {warnings.length ? (
          <ul className="space-y-2">{warnings.map((w) => seenBox(w.id, w.message))}</ul>
        ) : (
          <p className="text-body-sm text-success">Nessun avviso.</p>
        )}
      </section>

      {guard ? (
        <section className="space-y-3" aria-labelledby="guard-title">
          <div className="flex flex-wrap items-center gap-3">
            <h3 id="guard-title" className="flex items-center gap-2 text-heading-sm text-fg">
              <ShieldAlert aria-hidden className="size-5" />
              Brand Guard
            </h3>
            <Badge
              variant={
                guard.band === "critico" || guard.band === "debole"
                  ? "error"
                  : guard.band === "discreto"
                    ? "warning"
                    : "success"
              }
            >
              Coerenza con il brand: {guardBandLabels[guard.band]}
            </Badge>
          </div>
          {guardToSee.length ? (
            groupBySlide(guardToSee).map(([slide, list]) => (
              <div key={slide ?? "all"} className="space-y-2">
                <h4 className="text-label text-fg-muted">{slideLabel(slide)}</h4>
                <ul className="space-y-2">
                  {list.map((f) =>
                    seenBox(
                      f.key,
                      <>
                        <Badge variant={f.severity === "error" ? "error" : "warning"}>
                          {f.severity === "error" ? "Errore" : "Avviso"}
                        </Badge>{" "}
                        {f.slot ? <span className="text-fg-muted">«{f.slot}» · </span> : null}
                        {f.message}
                        {f.suggestion ? (
                          <span className="block text-fg-muted">Suggerimento: {f.suggestion}</span>
                        ) : null}
                      </>,
                    ),
                  )}
                </ul>
              </div>
            ))
          ) : (
            <p className="text-body-sm text-success">Nessuna segnalazione aperta.</p>
          )}
          {guard.notes.length ? (
            <details className="text-body-sm">
              <summary className="cursor-pointer text-fg-muted">
                {guard.notes.length} note informative
              </summary>
              <ul className="mt-2 space-y-1 text-fg">
                {guard.notes.map((f) => (
                  <li key={f.key}>
                    {slideLabel(f.slide)}: {f.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {guard.notRun.length ? (
            <p className="text-body-sm text-fg-muted">
              Controlli non eseguiti: {guard.notRun.map((n) => n.reason).join("; ")}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-3 border-t border-subtle pt-4" aria-labelledby="decision-title">
        <h3 id="decision-title" className="text-heading-sm text-fg">
          Decisione sulla versione {versionNumber}
        </h3>
        <div className="space-y-1">
          <Label htmlFor="review-note">
            {selfApproval ? "Nota (obbligatoria per approvare un tuo lavoro)" : "Nota"}
          </Label>
          <textarea
            id="review-note"
            rows={3}
            maxLength={2000}
            className={controlClass}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Per «Richiedi modifiche» scrivi cosa va cambiato"
          />
          {selfApproval ? (
            <p className="text-body-sm text-fg-muted">
              Hai inviato tu questo carosello: per approvarlo scrivi una nota per la cronologia.
            </p>
          ) : null}
        </div>
        {error ? (
          <div role="alert" className="space-y-1 text-body-sm text-error">
            <p>{error.text}</p>
            {error.checks.length ? (
              <ul className="list-disc pl-5">
                {error.checks.map((c) => (
                  <li key={c.id}>{c.message}</li>
                ))}
              </ul>
            ) : null}
            {error.reload ? (
              <Button variant="secondary" size="sm" onClick={() => router.refresh()}>
                <RefreshCw aria-hidden />
                Ricarica
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {canApprove ? (
            <Button disabled={pending || !canSubmitApproval} onClick={() => decide("approved")}>
              <BadgeCheck aria-hidden />
              Approva la versione {versionNumber}
            </Button>
          ) : null}
          {canReview ? (
            <Button
              variant="secondary"
              disabled={pending || !noteOk}
              onClick={() => decide("changes_requested")}
            >
              <MessageSquareWarning aria-hidden />
              Richiedi modifiche
            </Button>
          ) : null}
        </div>
        {canApprove && !canSubmitApproval ? (
          <p className="text-body-sm text-fg-muted">
            {blocked
              ? "L'approvazione resta bloccata finché ci sono problemi bloccanti."
              : !allSeen
                ? "Conferma «Ho visto» su ogni avviso per approvare."
                : "Scrivi la nota per approvare."}
          </p>
        ) : null}
      </section>
    </div>
  );
}
