"use client";

import type { ProductImportStatus } from "@forgecy/core";
import { Button } from "@forgecy/ui";
import Link from "next/link";
import type { Route } from "next";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("products");
  const action = useCatalogAction();
  const ids = { clientId: props.clientId, importId: props.importId };
  const p = props.budgetPercent;
  const canCancel = ["uploading", "analyzing", "needs_mapping", "failed"].includes(props.status);

  return (
    <div className="space-y-3">
      {props.status === "uploading" && props.usesAi ? (
        <Banner tone={p !== null && p >= 70 ? "warning" : "neutral"}>
          {t("controls.aiBanner", {
            mode: props.restricted ? "restricted" : "open",
            cost: props.costText ?? "",
          })}{" "}
          {p === null
            ? t("controls.noBudget")
            : t("controls.clientBudget", { client: props.clientName, percent: p })}
          {props.blockedByBudget
            ? ` ${t("controls.budgetBlocked", { client: props.clientName })}`
            : null}
        </Banner>
      ) : null}
      <ActionMessage result={action.result} />
      <div className="flex flex-wrap items-center gap-3">
        {props.status === "uploading" ? (
          <ConfirmDialog
            title={t("controls.startTitle")}
            confirmLabel={t("controls.start")}
            disabled={props.blockedByBudget}
            onConfirm={(f) =>
              action.run(() => startAction({ ...ids, aiConfirmed: f.get("aiConfirmed") === "on" }))
            }
            trigger={(open) => (
              <Button
                onClick={open}
                disabled={action.pending || !props.hasValidFiles || props.blockedByBudget}
              >
                {t("controls.start")}
              </Button>
            )}
          >
            {props.usesAi ? (
              <>
                <p>
                  {p !== null
                    ? t("controls.usesAiBudget", { cost: props.costText ?? "", percent: p })
                    : t("controls.usesAi", { cost: props.costText ?? "" })}
                </p>
                {p !== null && p >= 90 ? (
                  <p className="text-warning">{t("controls.budgetAlmost")}</p>
                ) : null}
                {props.restricted ? (
                  <label className="flex items-start gap-2 text-body-sm text-fg">
                    <input type="checkbox" name="aiConfirmed" required className="mt-1 size-4" />
                    {t("controls.confirmExternal")}
                  </label>
                ) : null}
              </>
            ) : (
              <p>{t("controls.noAi")}</p>
            )}
            <p>{t("controls.pausesForMapping")}</p>
          </ConfirmDialog>
        ) : null}
        {props.status === "failed" ? (
          <Button onClick={() => action.run(() => retryAction(ids))} disabled={action.pending}>
            {t("controls.retry")}
          </Button>
        ) : null}
        <Button asChild variant="secondary">
          <Link href={props.catalogHref}>{t("backToCatalog")}</Link>
        </Button>
        {canCancel ? (
          <ConfirmDialog
            title={t("controls.cancelTitle")}
            confirmLabel={t("controls.cancelImport")}
            danger
            onConfirm={() => action.run(() => cancelAction(ids))}
            trigger={(open) => (
              <Button variant="ghost" onClick={open} disabled={action.pending}>
                {t("controls.cancelImport")}
              </Button>
            )}
          >
            <p>{t("controls.cancelBody")}</p>
          </ConfirmDialog>
        ) : null}
      </div>
    </div>
  );
}
