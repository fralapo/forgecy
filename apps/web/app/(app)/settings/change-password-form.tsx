"use client";

import { Button, Input, Label } from "@forgecy/ui";
import { KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { PASSWORD_MAX } from "@/lib/password";
import { changePasswordAction, type ChangePasswordState } from "./actions";

/** The person's own password: asks for the current one, signs the other devices out. */
export function ChangePasswordForm() {
  const t = useTranslations("settings.password");
  const [state, action, pending] = useActionState<ChangePasswordState, FormData>(
    changePasswordAction,
    {},
  );
  return (
    <form action={action} className="mt-6 grid gap-2">
      <h3 className="text-heading-sm text-fg">{t("title")}</h3>
      <Label htmlFor="current-password">{t("current")}</Label>
      <Input
        id="current-password"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        maxLength={PASSWORD_MAX}
        required
      />
      <Label htmlFor="new-password">{t("new")}</Label>
      <Input
        id="new-password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        maxLength={PASSWORD_MAX}
        required
      />
      <Button type="submit" variant="secondary" disabled={pending} className="w-fit">
        <KeyRound aria-hidden />
        {t("submit")}
      </Button>
      {state.ok ? (
        <p role="status" className="text-body-sm text-success">
          {t("saved")}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-body-sm text-error">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
