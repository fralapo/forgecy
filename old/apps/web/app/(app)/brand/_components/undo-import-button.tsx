"use client";

import { Button } from "@forgecy/ui";
import { Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { undoImportAction } from "../actions";

/** Goes back to the version before the last automatic import; asks before replacing an open draft. */
export function UndoImportButton({
  slug,
  clientId,
  versionId,
}: {
  slug: string;
  clientId: string;
  versionId: string;
}) {
  const t = useTranslations("brand.overview");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = () =>
    start(async () => {
      setError(null);
      let res = await undoImportAction({ slug, clientId, versionId });
      // An open draft: the same question as "Restore as draft", asked with the server's text.
      if (!res.ok && res.code === "DRAFT-EXISTS" && window.confirm(res.error))
        res = await undoImportAction({ slug, clientId, versionId, replaceDraft: true });
      if (res.ok) router.refresh();
      else if (res.code !== "DRAFT-EXISTS") setError(res.error);
    });
  return (
    <span className="inline-flex flex-col gap-1">
      <Button variant="secondary" size="sm" disabled={pending} onClick={run}>
        <Undo2 aria-hidden />
        {t("undoImport")}
      </Button>
      {error ? (
        <span role="alert" className="max-w-xs text-body-sm text-error">
          {error}
        </span>
      ) : null}
    </span>
  );
}
