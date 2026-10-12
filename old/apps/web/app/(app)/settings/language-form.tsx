"use client";

import { Button, Label } from "@forgecy/ui";
import { Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useActionState, useEffect } from "react";
import { controlClass } from "../content/_components/action-button";
import { setLocaleAction, type LocaleState } from "./actions";

/** Interface language: saved on the person's account, applied on the next render. */
export function LanguageForm({
  current,
  languages,
  browserLanguage,
}: {
  current: string;
  languages: { code: string; name: string }[];
  browserLanguage: string;
}) {
  const t = useTranslations("settings.preferences");
  const tc = useTranslations("common");
  const router = useRouter();
  const [state, action, pending] = useActionState<LocaleState, FormData>(setLocaleAction, {});
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={action} className="mt-4 grid gap-2">
      <Label htmlFor="locale">{t("language")}</Label>
      <select id="locale" name="locale" defaultValue={current} className={controlClass}>
        <option value="">{t("automatic", { language: browserLanguage })}</option>
        {languages.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.name}
          </option>
        ))}
      </select>
      <p className="text-body-sm text-fg-muted">{t("languageHint")}</p>
      <Button type="submit" variant="secondary" disabled={pending} className="w-fit">
        <Languages aria-hidden />
        {tc("actions.save")}
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
