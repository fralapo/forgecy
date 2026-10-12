"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { setEmailNotificationsAction } from "./actions";

/** Opt-in: the bell's notifications also by email (saved on the person's account). */
export function EmailNotificationsForm({
  current,
  smtpReady,
}: {
  current: boolean;
  smtpReady: boolean;
}) {
  const t = useTranslations("settings.preferences");
  const [on, setOn] = useState(current);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="mt-6 grid gap-2">
      <label className="flex items-center gap-2 text-body-sm text-fg">
        <input
          type="checkbox"
          checked={on}
          disabled={pending || (!smtpReady && !on)}
          onChange={(e) => {
            const next = e.target.checked;
            setOn(next);
            setSaved(false);
            start(async () => {
              await setEmailNotificationsAction(next);
              setSaved(true);
            });
          }}
        />
        {t("emailNotifications")}
      </label>
      <p className="text-body-sm text-fg-muted">
        {smtpReady ? t("emailNotificationsHint") : t("emailNotificationsNoSmtp")}
      </p>
      {saved ? (
        <p role="status" className="text-body-sm text-success">
          {t("emailNotificationsSaved")}
        </p>
      ) : null}
    </div>
  );
}
