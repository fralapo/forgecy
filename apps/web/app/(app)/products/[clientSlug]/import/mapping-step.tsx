"use client";

import type { ColumnMapping } from "@forgecy/catalog/mapping";
import { Badge, Button, Card, cn } from "@forgecy/ui";
import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ActionMessage, useCatalogAction } from "../../_components/client";
import { selectClass } from "../../_components/ui";
import { confirmMappingAction } from "./actions";

export interface SheetView {
  id: string;
  name: string;
  headers: string[];
  sample: string[][];
  columns: string[];
  confidence: Array<"high" | "medium" | "low">;
  preset: string | null;
  savedName: string | null;
  listSeparator: string | null;
}

export function MappingStep(props: {
  clientId: string;
  importId: string;
  clientName: string;
  sheets: SheetView[];
  targets: Array<{ value: string; label: string }>;
}) {
  const t = useTranslations("products");
  if (props.sheets.length === 0)
    return (
      <Card>
        <p className="text-body-md text-fg-muted">{t("mapping.allMapped")}</p>
      </Card>
    );
  return (
    <>
      {props.sheets.map((s) => (
        <SheetMapping key={s.id} sheet={s} {...props} />
      ))}
    </>
  );
}

function SheetMapping({
  sheet,
  clientId,
  importId,
  clientName,
  targets,
}: {
  sheet: SheetView;
  clientId: string;
  importId: string;
  clientName: string;
  targets: Array<{ value: string; label: string }>;
}) {
  const t = useTranslations("products");
  const [columns, setColumns] = useState(sheet.columns);
  const [touched, setTouched] = useState<Set<number>>(new Set());
  const [save, setSave] = useState(!sheet.savedName);
  const [saveName, setSaveName] = useState(
    sheet.savedName ??
      (sheet.preset === "woocommerce" ? t("mapping.defaultNameWoo") : t("mapping.defaultName")),
  );
  const action = useCatalogAction();
  const hasName = columns.includes("name");
  const hasSku = columns.includes("sku");
  const fromAi = sheet.preset === "ai";

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-heading-sm">{t("mapping.title", { name: sheet.name })}</h2>
        {sheet.savedName ? (
          <Badge variant="info">{t("mapping.savedApplied", { name: sheet.savedName })}</Badge>
        ) : sheet.preset === "woocommerce" ? (
          <Badge variant="info">{t("mapping.woocommerce")}</Badge>
        ) : fromAi ? (
          <Badge variant="info" icon={Sparkles}>
            {t("proposedByAgent")}
          </Badge>
        ) : null}
      </div>
      {!sheet.savedName ? (
        <p className="text-body-sm text-fg-muted">
          {t("mapping.firstTime", { client: clientName })}
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-body-sm">
          <caption className="sr-only">{t("mapping.caption")}</caption>
          <thead className="border-b border-subtle text-label text-fg-muted">
            <tr>
              <th scope="col" className="py-2 pr-4 font-medium">
                {t("mapping.fileColumn")}
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                {t("mapping.productField")}
              </th>
              <th scope="col" className="py-2 font-medium">
                {t("mapping.preview")}
              </th>
            </tr>
          </thead>
          <tbody>
            {sheet.headers.map((h, i) => (
              <tr key={i} className="border-b border-subtle last:border-0 align-top">
                <th scope="row" className="py-2 pr-4 font-normal text-fg">
                  {h || t("mapping.column", { number: i + 1 })}
                </th>
                <td className="py-2 pr-4">
                  <select
                    aria-label={t("mapping.fieldFor", { header: h })}
                    className={cn(selectClass, "w-60")}
                    value={columns[i] ?? "ignore"}
                    onChange={(e) => {
                      setColumns((c) => c.map((v, j) => (j === i ? e.target.value : v)));
                      setTouched((t) => new Set(t).add(i));
                    }}
                  >
                    {targets.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  {sheet.confidence[i] && columns[i] !== "ignore" && !touched.has(i) ? (
                    <span className="mt-1 block text-fg-muted">
                      {fromAi
                        ? t("mapping.agentConfidence", {
                            confidence: t(`confidenceOf.${sheet.confidence[i]!}`),
                          })
                        : t(`confidenceOf.${sheet.confidence[i]!}`)}
                    </span>
                  ) : null}
                </td>
                <td className="max-w-80 py-2 text-fg-muted">
                  {sheet.sample
                    .map((r) => r[i] ?? "")
                    .filter(Boolean)
                    .slice(0, 3)
                    .map((v, k) => (
                      <span key={k} className="block truncate">
                        {v}
                      </span>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!hasName ? (
        <p role="alert" className="text-body-sm text-error">
          {t("mapping.nameRequired")}
        </p>
      ) : null}
      {hasName && !hasSku ? (
        <p className="text-body-sm text-warning">{t("mapping.noSku")}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-body-sm text-fg">
          <input
            type="checkbox"
            checked={save}
            onChange={(e) => setSave(e.target.checked)}
            className="size-4"
          />
          {t("mapping.save", { client: clientName })}
        </label>
        {save ? (
          <input
            aria-label={t("mapping.mappingName")}
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            maxLength={80}
            className={cn(selectClass, "w-60")}
          />
        ) : null}
      </div>
      <ActionMessage result={action.result} />
      <div>
        <Button
          disabled={!hasName || action.pending}
          onClick={() =>
            action.run(() =>
              confirmMappingAction({
                clientId,
                importId,
                fileId: sheet.id,
                mapping: {
                  columns: columns as ColumnMapping["columns"],
                  ...(sheet.listSeparator ? { listSeparator: sheet.listSeparator } : {}),
                  ...(sheet.preset ? { preset: sheet.preset as ColumnMapping["preset"] } : {}),
                },
                saveAs: save ? saveName : undefined,
              }),
            )
          }
        >
          {t("mapping.confirm")}
        </Button>
      </div>
    </Card>
  );
}
