"use client";

import { clientTransferAreas, type ClientTransferArea } from "@forgecy/core";
import { Button, Label } from "@forgecy/ui";
import { Download } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { controlClass } from "../../content/_components/action-button";
import { ActionFeedback } from "../_components/action-feedback";
import type { AdminActionResult } from "../_lib/admin-action";
import { startClientExportAction } from "./actions";

/** Tab “Export client” (page 68): client, contents, options, confirmation. */
export function ExportForm({
  clients,
  clientId,
}: {
  clients: { id: string; name: string }[];
  clientId: string;
}) {
  const t = useTranslations("clientTransfer.export");
  const router = useRouter();
  const [areas, setAreas] = useState<ClientTransferArea[]>([...clientTransferAreas]);
  const [excludeAi, setExcludeAi] = useState(true);
  const [agencyTemplates, setAgencyTemplates] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<AdminActionResult | null>(null);
  const [pending, start] = useTransition();
  const client = clients.find((c) => c.id === clientId);

  const toggle = (a: ClientTransferArea, on: boolean) =>
    setAreas((prev) =>
      on
        ? clientTransferAreas.filter((x) => x === a || prev.includes(x))
        : prev.filter((x) => x !== a),
    );

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <Label htmlFor="ie-client">{t("client")}</Label>
        <select
          id="ie-client"
          value={clientId}
          className={controlClass}
          onChange={(e) => {
            setConfirming(false);
            setResult(null);
            router.push(
              (e.target.value
                ? `/settings/import-export?client=${e.target.value}`
                : "/settings/import-export") as Route,
            );
          }}
        >
          <option value="">{t("chooseClient")}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-label text-fg">{t("areasLegend")}</legend>
        {clientTransferAreas.map((a) => (
          <div key={a} className="flex items-start gap-2">
            <input
              id={`ie-area-${a}`}
              type="checkbox"
              className="mt-1"
              checked={areas.includes(a)}
              aria-describedby={`ie-area-${a}-hint`}
              onChange={(e) => toggle(a, e.target.checked)}
            />
            <div>
              <label htmlFor={`ie-area-${a}`} className="text-body-sm text-fg">
                {t(`areas.${a}`)}
              </label>
              <p id={`ie-area-${a}-hint`} className="text-body-sm text-fg-muted">
                {t(`areas.${a}Hint`)}
              </p>
            </div>
          </div>
        ))}
      </fieldset>

      <div className="grid gap-2">
        <label className="flex items-center gap-2 text-body-sm text-fg">
          <input
            type="checkbox"
            checked={excludeAi}
            onChange={(e) => setExcludeAi(e.target.checked)}
          />
          {t("excludeUnapprovedAi")}
        </label>
        <label className="flex items-center gap-2 text-body-sm text-fg">
          <input
            type="checkbox"
            checked={agencyTemplates}
            disabled={!areas.includes("templates")}
            onChange={(e) => setAgencyTemplates(e.target.checked)}
          />
          {t("includeAgencyTemplates")}
        </label>
      </div>

      {confirming && client ? (
        <div
          role="alertdialog"
          aria-labelledby="ie-confirm"
          className="grid gap-3 rounded-md border border-subtle bg-app p-4"
        >
          <p id="ie-confirm" className="text-body-sm text-fg">
            {t("confirm", { client: client.name })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await startClientExportAction({
                    clientId,
                    areas,
                    excludeUnapprovedAi: excludeAi,
                    includeAgencyTemplates: agencyTemplates && areas.includes("templates"),
                  });
                  setResult(r);
                  setConfirming(false);
                  router.refresh();
                })
              }
            >
              {t("confirmButton")}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          className="w-fit"
          disabled={!client || !areas.length || pending}
          onClick={() => {
            setResult(null);
            setConfirming(true);
          }}
        >
          <Download aria-hidden className="size-4" />
          {t("submit")}
        </Button>
      )}
      {!areas.length ? <p className="text-body-sm text-fg-muted">{t("noAreas")}</p> : null}
      <div aria-live="polite">
        <ActionFeedback result={result} />
      </div>
    </div>
  );
}
