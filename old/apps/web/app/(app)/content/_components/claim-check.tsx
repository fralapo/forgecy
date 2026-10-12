"use client";

import { Button } from "@forgecy/ui";
import { ShieldQuestion } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { checkClaimsAction } from "../claim-actions";
import { RefreshWhile } from "./refresh-while";

/** “Check claims”: advisory AI pass; findings appear as warnings in the checks list. */
export function ClaimCheck({
  slug,
  clientId,
  contentId,
  running,
  disabled,
  lastCount,
}: {
  slug: string;
  clientId: string;
  contentId: string;
  /** A claim check is queued or running: the page refreshes until it ends. */
  running: boolean;
  disabled: boolean;
  /** Findings of the latest finished check, or null when there has been none. */
  lastCount: number | null;
}) {
  const t = useTranslations("content.editor.claims");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const busy = pending || running;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-subtle bg-surface p-3">
      <RefreshWhile active={running} />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled || busy}
        title={t("hint")}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await checkClaimsAction({ slug, clientId, contentId });
            if (!r.ok) setError(r.error);
            else router.refresh();
          });
        }}
      >
        <ShieldQuestion aria-hidden />
        {busy ? t("checking") : t("button")}
      </Button>
      <p className="text-body-sm text-fg-muted" role="status">
        {lastCount !== null && !busy ? t("last", { count: lastCount }) : t("hint")}
      </p>
      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
