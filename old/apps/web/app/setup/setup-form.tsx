"use client";

import { Button, Input, Label } from "@forgecy/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/password";
import { createFirstAdmin, type SetupState } from "./actions";

export function SetupForm({ tokenRequired }: { tokenRequired: boolean }) {
  const [state, action, pending] = useActionState<SetupState, FormData>(createFirstAdmin, {});
  const t = useTranslations("auth.setup");
  return (
    <form action={action} className="space-y-4">
      {tokenRequired ? (
        <div className="space-y-2">
          <Label htmlFor="setupToken">{t("setupToken")}</Label>
          <Input id="setupToken" name="setupToken" type="password" autoComplete="off" required />
          <p className="text-body-sm text-fg-muted">{t("setupTokenHint")}</p>
        </div>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="username">{t("username")}</Label>
        <Input id="username" name="username" autoComplete="username" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          maxLength={PASSWORD_MAX}
          required
        />
      </div>
      {state.error ? (
        <p role="alert" className="text-body-sm text-error">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {t("submit")}
      </Button>
    </form>
  );
}
