"use client";

import { Button, Label } from "@forgecy/ui";
import { Check, MessageSquareWarning } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { approveReportAction, requestReportChangesAction } from "../actions";
import { textareaClass } from "../_lib/styles";

/**
 * Review of a report in review: a person approves (with a note when approving
 * their own submission) or sends it back with a comment. Agents never see this.
 */
export function ReportReview({
  id,
  rev,
  ownSubmission,
}: {
  id: string;
  rev: number;
  ownSubmission: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("audit");
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) return setError(res.error ?? t("operationFailed"));
      setText("");
      router.refresh();
    });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="review-note">{t("reportReview.note")}</Label>
        <textarea
          id="review-note"
          value={text}
          maxLength={1000}
          className={textareaClass}
          onChange={(e) => setText(e.target.value)}
        />
        {ownSubmission ? (
          <span className="text-body-sm text-fg-muted">{t("reportReview.ownSubmission")}</span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          disabled={pending || (ownSubmission && !text.trim())}
          onClick={() =>
            run(() => approveReportAction({ id, rev, ...(text.trim() ? { note: text } : {}) }))
          }
        >
          <Check aria-hidden />
          {t("reportReview.approve")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending || !text.trim()}
          onClick={() => run(() => requestReportChangesAction({ id, rev, comment: text }))}
        >
          <MessageSquareWarning aria-hidden />
          {t("reportReview.requestChanges")}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
