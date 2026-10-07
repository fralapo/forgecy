"use client";

import { Button, Input, Label } from "@forgecy/ui";
import { UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { PASSWORD_MIN } from "@/lib/password";
import { createUserAction, type NewUserState } from "./actions";

export function NewUserForm() {
  const [state, action, pending] = useActionState<NewUserState, FormData>(createUserAction, {});
  const t = useTranslations("settings.newUser");
  return (
    <form action={action} className="mt-4 space-y-4">
      <div className="space-y-2">
        <Label htmlFor="user-username">{t("username")}</Label>
        <Input id="user-username" name="username" autoComplete="off" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="user-password">{t("password")}</Label>
        <Input
          id="user-password"
          name="password"
          type="password"
          minLength={PASSWORD_MIN}
          autoComplete="new-password"
          required
        />
      </div>
      <label className="flex items-center gap-2 text-body-sm text-fg">
        <input type="checkbox" name="isAdmin" className="size-4 accent-primary" />
        {t("isAdmin")}
      </label>
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
      <Button type="submit" disabled={pending}>
        <UserPlus aria-hidden />
        {t("submit")}
      </Button>
    </form>
  );
}
