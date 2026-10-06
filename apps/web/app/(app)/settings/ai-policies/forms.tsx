"use client";

import { aiPolicies, type AiPolicy } from "@forgecy/core";
import { Button, Input, Label } from "@forgecy/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { selectClass } from "@/app/(app)/audit/_lib/styles";
import { ActionFeedback } from "../_components/action-feedback";
import type { AdminActionResult } from "../_lib/admin-action";
import { setBudgetAction, setClientPolicyAction, setDefaultPolicyAction } from "./actions";

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AdminActionResult | null>(null);
  const run = (fn: () => Promise<AdminActionResult>) =>
    start(async () => {
      const res = await fn();
      setResult(res);
      if (res.ok) router.refresh();
    });
  return { pending, result, run };
}

export function DefaultPolicyForm({ current }: { current: AiPolicy }) {
  const t = useTranslations("admin.aiPolicies.default");
  const te = useTranslations("enums.aiPolicy");
  const { pending, result, run } = useAction();
  const id = useId();
  return (
    <form
      className="mt-4 flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const policy = new FormData(e.currentTarget).get("policy") as AiPolicy;
        run(() => setDefaultPolicyAction(policy));
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>{t("label")}</Label>
        <select id={id} name="policy" className={selectClass} defaultValue={current}>
          {aiPolicies.map((p) => (
            <option key={p} value={p}>
              {te(p)}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={pending}>
        {t("save")}
      </Button>
      <div className="basis-full">
        <ActionFeedback result={result} />
      </div>
    </form>
  );
}

export function ClientPolicySelect({
  clientId,
  name,
  policy,
}: {
  clientId: string;
  name: string;
  policy: AiPolicy;
}) {
  const t = useTranslations("admin.aiPolicies.clients");
  const te = useTranslations("enums.aiPolicy");
  const { pending, result, run } = useAction();
  return (
    <div className="flex flex-col gap-1">
      <select
        aria-label={t("policyFor", { name })}
        className={selectClass}
        defaultValue={policy}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as AiPolicy;
          run(() => setClientPolicyAction(clientId, next));
        }}
      >
        {aiPolicies.map((p) => (
          <option key={p} value={p}>
            {te(p)}
          </option>
        ))}
      </select>
      <ActionFeedback result={result} />
    </div>
  );
}

/** Monthly limit in dollars; empty means no limit. `clientId` null is the agency budget. */
export function BudgetForm({
  clientId,
  current,
  label,
  hideLabel,
  placeholder,
}: {
  clientId: string | null;
  current: number | null;
  label: string;
  hideLabel?: boolean;
  placeholder?: string;
}) {
  const t = useTranslations("admin.aiPolicies.budget");
  const { pending, result, run } = useAction();
  const id = useId();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const amount = String(new FormData(e.currentTarget).get("amount") ?? "");
        run(() => setBudgetAction(clientId, amount));
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={id} className={hideLabel ? "sr-only" : undefined}>
          {label}
        </Label>
        <Input
          id={id}
          name="amount"
          inputMode="decimal"
          className="w-32"
          defaultValue={current === null ? "" : (current / 100).toFixed(2)}
          placeholder={placeholder}
        />
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>
        {t("save")}
      </Button>
      <div className="basis-full">
        <ActionFeedback result={result} />
      </div>
    </form>
  );
}
