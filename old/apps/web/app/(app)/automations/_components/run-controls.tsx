"use client";

import type { AutomationStatus } from "@forgecy/core";
import { Button } from "@forgecy/ui";
import { Copy, Pause, Play, RotateCcw, Square, Trash2 } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  cancelRunAction,
  deleteAutomationAction,
  duplicateAutomationAction,
  pauseAutomationAction,
  resumeAutomationAction,
  retryFailedAction,
  type ActionResult,
} from "../actions";

type Out = { id?: string; runId?: string };

/** Secondary actions of page 59: pause, resume, cancel, retry failed items, duplicate, delete. */
export function RunControls({
  id,
  name,
  status,
  canDelete,
  failedCount,
  needsConfirm,
}: {
  id: string;
  name: string;
  status: AutomationStatus;
  canDelete: boolean;
  failedCount: number;
  /** Resuming or retrying uses more than 90% of the budget left. */
  needsConfirm: boolean;
}) {
  const t = useTranslations("automations.detail");
  const ts = useTranslations("automations.detail.summary");
  const router = useRouter();
  const [ask, setAsk] = useState<"cancel" | "delete" | null>(null);
  const [confirmCost, setConfirmCost] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const act = (fn: () => Promise<ActionResult<Out>>, go?: (r: Out) => string) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error);
      setAsk(null);
      if (go) router.push(go(r) as Route);
      else router.refresh();
    });
  };
  const canRetry = status === "draft" && failedCount > 0;

  return (
    <div className="grid justify-items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {status === "active" ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => act(() => pauseAutomationAction({ id }))}
          >
            <Pause aria-hidden className="size-4" />
            {t("actions.pause")}
          </Button>
        ) : null}
        {status === "paused" ? (
          <Button
            type="button"
            size="sm"
            disabled={pending || (needsConfirm && !confirmCost)}
            onClick={() => act(() => resumeAutomationAction({ id, confirmCost }))}
          >
            <Play aria-hidden className="size-4" />
            {t("actions.resume")}
          </Button>
        ) : null}
        {status === "active" || status === "paused" ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => setAsk("cancel")}
          >
            <Square aria-hidden className="size-4" />
            {t("actions.cancel")}
          </Button>
        ) : null}
        {canRetry ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending || (needsConfirm && !confirmCost)}
            onClick={() =>
              act(
                () => retryFailedAction({ id, confirmCost }),
                (r) => `/automations/${id}?tab=runs&run=${r.runId}`,
              )
            }
          >
            <RotateCcw aria-hidden className="size-4" />
            {t("actions.retry")}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() =>
            act(
              () => duplicateAutomationAction({ id, name: t("actions.copyName", { name }) }),
              (r) => `/automations/${r.id}`,
            )
          }
        >
          <Copy aria-hidden className="size-4" />
          {t("actions.duplicate")}
        </Button>
        {canDelete ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => setAsk("delete")}
          >
            <Trash2 aria-hidden className="size-4" />
            {t("actions.delete")}
          </Button>
        ) : null}
      </div>
      {needsConfirm && (status === "paused" || canRetry) ? (
        <label className="flex items-center gap-2 text-body-sm text-fg">
          <input
            type="checkbox"
            checked={confirmCost}
            onChange={(e) => setConfirmCost(e.target.checked)}
          />
          {ts("confirmCost")}
        </label>
      ) : null}
      {ask ? (
        <div
          role="alertdialog"
          aria-labelledby="rc-ask"
          className="grid max-w-md gap-3 rounded-md border border-subtle bg-surface p-4"
        >
          <p id="rc-ask" className="text-body-sm text-fg">
            {ask === "cancel" ? t("actions.cancelConfirm") : t("actions.deleteConfirm", { name })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={ask === "delete" ? "danger" : "primary"}
              disabled={pending}
              onClick={() =>
                ask === "cancel"
                  ? act(() => cancelRunAction({ id }))
                  : act(
                      () => deleteAutomationAction({ id }),
                      () => "/automations",
                    )
              }
            >
              {ask === "cancel" ? t("actions.cancel") : t("actions.deleteConfirmButton")}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setAsk(null)}>
              {t("actions.keep")}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
