"use client";

import { Button, Label } from "@forgecy/ui";
import { MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { addCommentAction, resolveCommentAction } from "../actions";
import { ActionButton, controlClass } from "./action-button";
import { useFormat } from "@/lib/use-format";

export interface ReviewComment {
  id: string;
  body: string;
  authorName: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** Comment thread of one slide (or of the whole carousel when `slideId` is null). */
export function ReviewComments({
  slug,
  clientId,
  contentId,
  slideId,
  label,
  comments,
  canComment,
}: {
  slug: string;
  clientId: string;
  contentId: string;
  slideId: string | null;
  label: string;
  comments: ReviewComment[];
  canComment: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("content.review.comments");
  const format = useFormat();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const open = comments.filter((c) => !c.resolvedAt);
  const resolved = comments.filter((c) => c.resolvedAt);
  const fieldId = `comment-${slideId ?? "all"}`;
  const base = { slug, clientId, id: contentId };

  return (
    <div className="space-y-2">
      {open.length ? (
        <ul className="space-y-2">
          {open.map((c) => (
            <li key={c.id} className="space-y-1 rounded-md border border-subtle p-2 text-body-sm">
              <p className="whitespace-pre-line text-fg">{c.body}</p>
              <p className="text-fg-muted">
                {c.authorName ?? t("removedUser")} · {format.date(c.createdAt, "dateTime")}
              </p>
              <ActionButton
                size="sm"
                variant="ghost"
                action={() => resolveCommentAction({ ...base, commentId: c.id })}
              >
                {t("resolve")}
              </ActionButton>
            </li>
          ))}
        </ul>
      ) : null}
      {resolved.length ? (
        <details className="text-body-sm">
          <summary className="cursor-pointer text-fg-muted">
            {t("resolved", { count: resolved.length })}
          </summary>
          <ul className="mt-2 space-y-1">
            {resolved.map((c) => (
              <li key={c.id} className="text-fg-muted">
                <span className="line-through">{c.body}</span> · {c.authorName ?? t("removedUser")}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {canComment ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              const r = await addCommentAction({ ...base, body, slideId });
              if (!r.ok) return setError(r.error);
              setBody("");
              router.refresh();
            });
          }}
        >
          <Label htmlFor={fieldId} className="sr-only">
            {t("commentOn", { target: label })}
          </Label>
          <textarea
            id={fieldId}
            rows={2}
            maxLength={2000}
            className={controlClass}
            placeholder={t("commentOn", { target: label })}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <Button type="submit" size="sm" variant="secondary" disabled={pending || !body.trim()}>
            <MessageSquare aria-hidden />
            {t("submit")}
          </Button>
          {error ? (
            <p role="alert" className="text-body-sm text-error">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
