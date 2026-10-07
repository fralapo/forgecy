"use client";

import { Button } from "@forgecy/ui";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

/** "Retry now" plus an automatic retry: reloading leaves the page once the restore is over. */
export function RetryCountdown({ seconds }: { seconds: number }) {
  const t = useTranslations("admin.backup.restore.maintenance");
  const [left, setLeft] = useState(seconds);
  const [retrying, setRetrying] = useState(false);
  const retry = () => {
    setRetrying(true);
    window.location.reload();
  };
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => {
      const remaining = Math.max(0, seconds - Math.floor((Date.now() - started) / 1000));
      setLeft(remaining);
      if (remaining === 0) {
        clearInterval(id);
        window.location.reload();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [seconds]);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" onClick={retry} disabled={retrying}>
        <RefreshCw aria-hidden className="size-4" />
        {retrying ? t("retrying") : t("retryNow")}
      </Button>
      <p role="status" aria-live="polite" className="text-body-sm text-fg-muted">
        {t("retryIn", { seconds: left })}
      </p>
    </div>
  );
}
