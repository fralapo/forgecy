"use client";

import { aiPolicies, type AiPolicy } from "@forgecy/core";
import { Button, Input, Label } from "@forgecy/ui";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { createClientAction, type ClientFormState } from "./actions";

const selectClass =
  "h-10 w-full rounded-md border border-control bg-surface px-3 text-body-sm text-fg focus-visible:outline-2 focus-visible:outline-focus";

export function NewClientForm({ defaultPolicy }: { defaultPolicy: AiPolicy }) {
  const [state, action, pending] = useActionState<ClientFormState, FormData>(
    createClientAction,
    {},
  );
  const t = useTranslations("clients.new");
  const te = useTranslations("enums");
  return (
    <form action={action} className="mt-4 space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">{t("name")}</Label>
        <Input id="name" name="name" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="websiteUrl">{t("website")}</Label>
        <Input id="websiteUrl" name="websiteUrl" type="url" placeholder={t("websitePlaceholder")} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="sector">{t("industry")}</Label>
        <Input id="sector" name="sector" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="status">{t("status")}</Label>
        <select id="status" name="status" className={selectClass} defaultValue="prospect">
          <option value="prospect">{te("clientStatus.prospect")}</option>
          <option value="active">{te("clientStatus.active")}</option>
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="aiPolicy">{t("aiPolicy")}</Label>
        <select id="aiPolicy" name="aiPolicy" className={selectClass} defaultValue={defaultPolicy}>
          {aiPolicies.map((p) => (
            <option key={p} value={p}>
              {te(`aiPolicy.${p}`)}
            </option>
          ))}
        </select>
      </div>
      {state.error ? (
        <p role="alert" className="text-body-sm text-error">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="text-body-sm text-success">
          {t("created")}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        <Plus aria-hidden />
        {t("submit")}
      </Button>
    </form>
  );
}
