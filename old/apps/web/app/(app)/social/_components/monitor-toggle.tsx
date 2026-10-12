"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { setMonitoredAction } from "../actions";

/** "Check automatically": the interval stays at its default and is not shown. */
export function MonitorToggle({
  slug,
  profileId,
  monitored,
}: {
  slug: string;
  profileId: string;
  monitored: boolean;
}) {
  const t = useTranslations("social.list");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <label className="inline-flex items-center gap-2 text-body-sm text-fg">
        <input
          type="checkbox"
          checked={monitored}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.checked;
            setError(null);
            start(async () => {
              const r = await setMonitoredAction(slug, profileId, next);
              if (!r.ok) setError(r.error);
              router.refresh();
            });
          }}
          className="size-4 accent-primary"
        />
        <span>{t("monitor")}</span>
        <span className="text-fg-muted">({t("monitorHint")})</span>
      </label>
      {error ? (
        <span role="alert" className="max-w-xs text-body-sm text-error">
          {error}
        </span>
      ) : null}
    </span>
  );
}
