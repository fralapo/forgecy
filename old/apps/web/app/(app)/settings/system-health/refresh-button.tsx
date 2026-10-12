"use client";

import { Button } from "@forgecy/ui";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useTransition } from "react";

/** Checks again now, and every 30 seconds while the page is open. */
export function RefreshButton() {
  const t = useTranslations("admin.health");
  const router = useRouter();
  const [pending, start] = useTransition();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(id);
  }, [router]);
  return (
    <Button
      type="button"
      variant="secondary"
      disabled={pending}
      onClick={() => start(() => router.refresh())}
    >
      <RefreshCw aria-hidden className="size-4" />
      {t("checkNow")}
    </Button>
  );
}
