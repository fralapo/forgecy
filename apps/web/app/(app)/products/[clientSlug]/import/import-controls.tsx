"use client";

import type { ProductImportStatus } from "@forgecy/core";
import { Button } from "@forgecy/ui";
import Link from "next/link";
import type { Route } from "next";
import { ActionMessage, ConfirmDialog, useCatalogAction } from "../../_components/client";
import { Banner } from "../../_components/ui";
import { cancelAction, retryAction, startAction } from "./actions";

/** Primary and destructive actions of the import page: start, retry, cancel. */
export function ImportControls(props: {
  clientId: string;
  clientName: string;
  importId: string;
  status: ProductImportStatus;
  catalogHref: Route;
  usesAi: boolean;
  restricted: boolean;
  costText: string | null;
  budgetPercent: number | null;
  blockedByBudget: boolean;
  hasValidFiles: boolean;
}) {
  const action = useCatalogAction();
  const ids = { clientId: props.clientId, importId: props.importId };
  const p = props.budgetPercent;
  const canCancel = ["uploading", "analyzing", "needs_mapping", "failed"].includes(props.status);

  return (
    <div className="space-y-3">
      {props.status === "uploading" && props.usesAi ? (
        <Banner tone={p !== null && p >= 70 ? "warning" : "neutral"}>
          AI:{" "}
          {props.restricted
            ? "external providers with confirmation"
            : "external providers or local model"}{" "}
          · estimated cost {props.costText}.{" "}
          {p === null ? "No monthly budget set." : `${props.clientName} budget: ${p}% used.`}
          {props.blockedByBudget
            ? ` ${props.clientName} AI budget used up. An Admin user can raise it; meanwhile you can import without AI analysis by choosing “Use as source” for PDFs. (BUDGET-EXCEEDED)`
            : ""}
        </Banner>
      ) : null}
      <ActionMessage result={action.result} />
      <div className="flex flex-wrap items-center gap-3">
        {props.status === "uploading" ? (
          <ConfirmDialog
            title="Start the analysis?"
            confirmLabel="Start analysis"
            disabled={props.blockedByBudget}
            onConfirm={(f) =>
              action.run(() => startAction({ ...ids, aiConfirmed: f.get("aiConfirmed") === "on" }))
            }
            trigger={(open) => (
              <Button
                onClick={open}
                disabled={action.pending || !props.hasValidFiles || props.blockedByBudget}
              >
                Start analysis
              </Button>
            )}
          >
            {props.usesAi ? (
              <>
                <p>
                  The analysis uses AI · estimated cost {props.costText}
                  {p !== null ? ` · budget used ${p}%` : ""}.
                </p>
                {p !== null && p >= 90 ? (
                  <p className="text-warning">The monthly budget is almost used up: continue?</p>
                ) : null}
                {props.restricted ? (
                  <label className="flex items-start gap-2 text-body-sm text-fg">
                    <input type="checkbox" name="aiConfirmed" required className="mt-1 size-4" />I
                    confirm sending these files to the external AI provider.
                  </label>
                ) : null}
              </>
            ) : (
              <p>The analysis doesn’t use AI: mapping, matching by file name and SKU.</p>
            )}
            <p>If some sheets have no saved mapping, the analysis pauses for mapping.</p>
          </ConfirmDialog>
        ) : null}
        {props.status === "failed" ? (
          <Button onClick={() => action.run(() => retryAction(ids))} disabled={action.pending}>
            Retry from step
          </Button>
        ) : null}
        <Button asChild variant="secondary">
          <Link href={props.catalogHref}>Back to catalog</Link>
        </Button>
        {canCancel ? (
          <ConfirmDialog
            title="Cancel the import?"
            confirmLabel="Cancel import"
            danger
            onConfirm={() => action.run(() => cancelAction(ids))}
            trigger={(open) => (
              <Button variant="ghost" onClick={open} disabled={action.pending}>
                Cancel import
              </Button>
            )}
          >
            <p>Uploaded files stay in the import archive for 7 days; no products are created.</p>
          </ConfirmDialog>
        ) : null}
      </div>
    </div>
  );
}
