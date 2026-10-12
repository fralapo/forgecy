"use client";

import { Button } from "@forgecy/ui";
import { HardDriveUpload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { ActionFeedback } from "../_components/action-feedback";
import type { AdminActionResult } from "../_lib/admin-action";
import { storageWriteTestAction } from "./actions";

export function WriteTest() {
  const t = useTranslations("admin.storage.test");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AdminActionResult | null>(null);
  return (
    <div className="mt-4 flex flex-col gap-2">
      <Button
        type="button"
        variant="secondary"
        className="self-start"
        disabled={pending}
        onClick={() => start(async () => setResult(await storageWriteTestAction()))}
      >
        <HardDriveUpload aria-hidden className="size-4" />
        {t(pending ? "running" : "button")}
      </Button>
      <ActionFeedback result={result} />
    </div>
  );
}
