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
          {props.restricted ? "provider esterni con conferma" : "provider esterni o modello locale"}{" "}
          · costo stimato {props.costText}.{" "}
          {p === null
            ? "Nessun budget mensile impostato."
            : `Budget di ${props.clientName}: ${p}% usato.`}
          {props.blockedByBudget
            ? ` Budget AI di ${props.clientName} esaurito. Un utente Admin può aumentarlo; intanto puoi importare senza analisi AI scegliendo «Usa come fonte» per i PDF. (BUDGET-EXCEEDED)`
            : ""}
        </Banner>
      ) : null}
      <ActionMessage result={action.result} />
      <div className="flex flex-wrap items-center gap-3">
        {props.status === "uploading" ? (
          <ConfirmDialog
            title="Avviare l'analisi?"
            confirmLabel="Avvia analisi"
            disabled={props.blockedByBudget}
            onConfirm={(f) =>
              action.run(() => startAction({ ...ids, aiConfirmed: f.get("aiConfirmed") === "on" }))
            }
            trigger={(open) => (
              <Button
                onClick={open}
                disabled={action.pending || !props.hasValidFiles || props.blockedByBudget}
              >
                Avvia analisi
              </Button>
            )}
          >
            {props.usesAi ? (
              <>
                <p>
                  L&apos;analisi usa l&apos;AI · costo stimato {props.costText}
                  {p !== null ? ` · budget usato ${p}%` : ""}.
                </p>
                {p !== null && p >= 90 ? (
                  <p className="text-warning">Il budget mensile è quasi esaurito: confermi?</p>
                ) : null}
                {props.restricted ? (
                  <label className="flex items-start gap-2 text-body-sm text-fg">
                    <input type="checkbox" name="aiConfirmed" required className="mt-1 size-4" />
                    Confermo l&apos;invio di questi file al provider AI esterno.
                  </label>
                ) : null}
              </>
            ) : (
              <p>L&apos;analisi non usa l&apos;AI: mappatura, abbinamento per nome file e SKU.</p>
            )}
            <p>
              Se ci sono fogli senza mappatura salvata, l&apos;analisi si ferma per la mappatura.
            </p>
          </ConfirmDialog>
        ) : null}
        {props.status === "failed" ? (
          <Button onClick={() => action.run(() => retryAction(ids))} disabled={action.pending}>
            Riprova dal passo
          </Button>
        ) : null}
        <Button asChild variant="secondary">
          <Link href={props.catalogHref}>Torna al catalogo</Link>
        </Button>
        {canCancel ? (
          <ConfirmDialog
            title="Annullare l'import?"
            confirmLabel="Annulla import"
            danger
            onConfirm={() => action.run(() => cancelAction(ids))}
            trigger={(open) => (
              <Button variant="ghost" onClick={open} disabled={action.pending}>
                Annulla import
              </Button>
            )}
          >
            <p>
              I file caricati restano negli archivi dell&apos;import per 7 giorni, nessun prodotto
              viene creato.
            </p>
          </ConfirmDialog>
        ) : null}
      </div>
    </div>
  );
}
