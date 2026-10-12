"use client";

import { Button, Input, Label } from "@forgecy/ui";
import { MailCheck, PlugZap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { ActionFeedback } from "../_components/action-feedback";
import type { AdminActionResult } from "../_lib/admin-action";
import { sendTestEmailAction, verifySmtpAction } from "./actions";

export function SmtpChecks({ defaultTo, disabled }: { defaultTo: string; disabled: boolean }) {
  const t = useTranslations("admin.smtp");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AdminActionResult | null>(null);
  const run = (fn: () => Promise<AdminActionResult>) =>
    start(async () => {
      setResult(await fn());
      router.refresh();
    });
  return (
    <form
      className="mt-4 flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const to = String(new FormData(e.currentTarget).get("to") ?? "");
        run(() => sendTestEmailAction(to));
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="smtp-to">{t("test.to")}</Label>
        <Input id="smtp-to" name="to" type="email" defaultValue={defaultTo} required />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || disabled}>
          <MailCheck aria-hidden className="size-4" />
          {t("test.send")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending || disabled}
          onClick={() => run(verifySmtpAction)}
        >
          <PlugZap aria-hidden className="size-4" />
          {t("verify.button")}
        </Button>
      </div>
      <ActionFeedback result={result} />
    </form>
  );
}
