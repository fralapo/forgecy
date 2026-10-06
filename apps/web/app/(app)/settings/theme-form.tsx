"use client";

import { Label } from "@forgecy/ui";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { controlClass } from "../content/_components/action-button";
import { setThemeAction } from "./actions";

/** Light, dark or the system's: saved on this browser and applied at once. */
export function ThemeForm({ current }: { current: "light" | "dark" | null }) {
  const t = useTranslations("settings.preferences");
  const [value, setValue] = useState<string>(current ?? "");
  const [saved, setSaved] = useState(false);
  const [, start] = useTransition();
  return (
    <div className="mt-6 grid gap-2">
      <Label htmlFor="theme">{t("theme")}</Label>
      <select
        id="theme"
        value={value}
        className={controlClass}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          setSaved(false);
          if (next) document.documentElement.dataset.theme = next;
          else delete document.documentElement.dataset.theme;
          start(async () => {
            await setThemeAction(next);
            setSaved(true);
          });
        }}
      >
        <option value="">{t("themeSystem")}</option>
        <option value="light">{t("themeLight")}</option>
        <option value="dark">{t("themeDark")}</option>
      </select>
      <p className="text-body-sm text-fg-muted">{t("themeHint")}</p>
      {saved ? (
        <p role="status" className="text-body-sm text-success">
          {t("themeSaved")}
        </p>
      ) : null}
    </div>
  );
}
