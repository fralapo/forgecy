"use client";

import { Button, Label } from "@forgecy/ui";
import { Check, FileDown, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { ActionResult } from "../actions";
import {
  approveClientBookAction,
  exportClientBookAction,
  rerenderClientBookAction,
} from "../actions";
import { controlClass } from "./section-editor";

/** Next step of a client Brand Book: render again, approve the preview, export the final PDF. */
export function ClientBookActions({
  slug,
  clientId,
  exportId,
  status,
  rendered,
  ownBook,
  noteMin,
}: {
  slug: string;
  clientId: string;
  exportId: string;
  status: "draft" | "approved";
  rendered: boolean;
  ownBook: boolean;
  noteMin: number;
}) {
  const t = useTranslations("brand.book");
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [pending, start] = useTransition();
  const ids = { slug, clientId, exportId };

  const act = (fn: () => Promise<ActionResult>, onDone?: () => void) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
      else {
        onDone?.();
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-2 text-left">
      {status === "draft" && rendered ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => approveClientBookAction({ ...ids, note }));
          }}
        >
          <Label htmlFor={`cb-note-${exportId}`}>{t("approveNote")}</Label>
          {ownBook ? (
            <p id={`cb-note-hint-${exportId}`} className="text-body-sm text-fg-muted">
              {t("approveNoteSelf", { min: noteMin })}
            </p>
          ) : null}
          <textarea
            id={`cb-note-${exportId}`}
            className={controlClass}
            rows={2}
            maxLength={2000}
            value={note}
            aria-describedby={ownBook ? `cb-note-hint-${exportId}` : undefined}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            type="submit"
            size="sm"
            disabled={pending || (ownBook && note.trim().length < noteMin)}
          >
            <Check aria-hidden className="size-4" />
            {t("approve")}
          </Button>
        </form>
      ) : null}
      {status === "draft" ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            act(
              () => rerenderClientBookAction(ids),
              () => setQueued(true),
            )
          }
        >
          <RefreshCw aria-hidden className="size-4" />
          {t("renderAgain")}
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          disabled={pending || queued}
          onClick={() =>
            act(
              () => exportClientBookAction(ids),
              () => setQueued(true),
            )
          }
        >
          <FileDown aria-hidden className="size-4" />
          {t("exportFinal")}
        </Button>
      )}
      {queued && status === "approved" ? (
        <p role="status" className="text-body-sm text-fg-muted">
          {t("exportQueued")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
