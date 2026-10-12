"use client";

import { productFactStatuses, type ProductFactStatus } from "@forgecy/core";
import { Badge, Button, Card } from "@forgecy/ui";
import { Plus, Save, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ActionMessage, useCatalogAction } from "../../_components/client";
import { selectClass, textareaClass } from "../../_components/ui";
import { deleteFactAction, saveFactAction } from "./actions";

export interface FactView {
  id: string;
  text: string;
  keywords: string;
  status: ProductFactStatus;
  source: string;
}

const emptyFact: Omit<FactView, "id"> = {
  text: "",
  keywords: "",
  status: "catalog_only",
  source: "",
};

/** Fact bank: claims about the product with how far they can be trusted and where they come from. */
export function FactsPanel({
  clientId,
  productId,
  facts,
}: {
  clientId: string;
  productId: string;
  facts: FactView[];
}) {
  const t = useTranslations("products.facts");
  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-heading-sm text-fg">{t("title")}</h2>
        <p className="text-body-sm text-fg-muted">{t("intro")}</p>
      </div>
      {facts.length ? (
        <ul className="space-y-4">
          {facts.map((f) => (
            <li key={f.id} className="border-b border-subtle pb-4 last:border-0">
              <FactForm clientId={clientId} productId={productId} fact={f} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-sm text-fg-muted">{t("empty")}</p>
      )}
      <FactForm clientId={clientId} productId={productId} fact={null} />
    </Card>
  );
}

function FactForm({
  clientId,
  productId,
  fact,
}: {
  clientId: string;
  productId: string;
  fact: FactView | null;
}) {
  const t = useTranslations("products.facts");
  const action = useCatalogAction();
  const [v, setV] = useState<Omit<FactView, "id">>(fact ?? emptyFact);
  const set = (patch: Partial<typeof v>) => setV((cur) => ({ ...cur, ...patch }));
  return (
    <form
      aria-label={fact ? t("editLabel", { text: fact.text }) : t("addLabel")}
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        action.run(
          () => saveFactAction({ clientId, productId, ...(fact ? { factId: fact.id } : {}), ...v }),
          (r) => {
            if (r.ok && !fact) setV(emptyFact);
          },
        );
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {fact ? <Badge>{t(`status.${fact.status}`)}</Badge> : null}
      </div>
      <label className="block text-body-sm text-fg">
        {t("text")}
        <textarea
          required
          rows={2}
          maxLength={500}
          className={textareaClass}
          value={v.text}
          onChange={(e) => set({ text: e.target.value })}
        />
      </label>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="block text-body-sm text-fg">
          {t("statusLabel")}
          <select
            className={selectClass}
            value={v.status}
            onChange={(e) => set({ status: e.target.value as ProductFactStatus })}
          >
            {productFactStatuses.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-body-sm text-fg">
          {t("source")}
          <input
            maxLength={300}
            className={textareaClass}
            placeholder={t("sourcePlaceholder")}
            value={v.source}
            onChange={(e) => set({ source: e.target.value })}
          />
        </label>
      </div>
      <label className="block text-body-sm text-fg">
        {t("keywords")}
        <input
          className={textareaClass}
          value={v.keywords}
          onChange={(e) => set({ keywords: e.target.value })}
        />
        <span className="text-fg-muted">{t("keywordsHint")}</span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={action.pending}>
          {fact ? <Save aria-hidden /> : <Plus aria-hidden />}
          {fact ? t("save") : t("add")}
        </Button>
        {fact ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={action.pending}
            onClick={() =>
              action.run(() => deleteFactAction({ clientId, productId, factId: fact.id }))
            }
          >
            <Trash2 aria-hidden />
            {t("delete")}
          </Button>
        ) : null}
      </div>
      <ActionMessage result={action.result} />
    </form>
  );
}
