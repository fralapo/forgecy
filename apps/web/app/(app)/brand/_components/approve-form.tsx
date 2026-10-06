"use client";

import { Button, Input, Label } from "@forgecy/ui";
import { BadgeCheck, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { publishAction, returnToDraftAction } from "../actions";
import { controlClass } from "./section-editor";

const CHANGELOG_MIN = 20;
const NOTE_MIN = 10;

export function ApproveForm({
  slug,
  clientId,
  versionId,
  number,
  rev,
  inReview,
  checks,
  selfApproval,
  doneHref,
}: {
  slug: string;
  clientId: string;
  versionId: string;
  number: number;
  rev: number;
  inReview: boolean;
  checks: Array<{ key: string; message: string }>;
  selfApproval: boolean;
  doneHref: string;
}) {
  const router = useRouter();
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [changelog, setChangelog] = useState("");
  const [note, setNote] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ready =
    checks.every((c) => seen.has(c.key)) &&
    changelog.trim().length >= CHANGELOG_MIN &&
    (!selfApproval || note.trim().length >= NOTE_MIN);

  return (
    <div className="space-y-6">
      {checks.length ? (
        <fieldset className="space-y-2">
          <legend className="text-heading-sm text-fg">Open checks</legend>
          <p className="text-body-sm text-fg-muted">
            No check blocks publishing: confirm you have seen each one.
          </p>
          <ul className="space-y-2">
            {checks.map((c) => (
              <li key={c.key} className="flex items-start gap-3 text-body-sm">
                <input
                  id={`seen-${c.key}`}
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={seen.has(c.key)}
                  onChange={(e) =>
                    setSeen((s) => {
                      const next = new Set(s);
                      if (e.target.checked) next.add(c.key);
                      else next.delete(c.key);
                      return next;
                    })
                  }
                />
                <label htmlFor={`seen-${c.key}`} className="text-fg">
                  <span className="text-warning">Seen:</span> {c.message}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : (
        <p className="text-body-sm text-success">No open checks.</p>
      )}

      <div className="space-y-1">
        <Label htmlFor="changelog">Changelog</Label>
        <textarea
          id="changelog"
          rows={3}
          className={controlClass}
          value={changelog}
          onChange={(e) => setChangelog(e.target.value)}
          placeholder="What changes in this version and why"
        />
        <p className="text-body-sm text-fg-muted">
          At least {CHANGELOG_MIN} characters: it stays in the history.
        </p>
      </div>
      {selfApproval ? (
        <div className="space-y-1">
          <Label htmlFor="self-note">Approval note</Label>
          <Input id="self-note" value={note} onChange={(e) => setNote(e.target.value)} />
          <p className="text-body-sm text-fg-muted">
            You’re approving a draft you prepared yourself: write a note for the history.
          </p>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-3 border-t border-subtle pt-4">
        <Button
          disabled={!ready || pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await publishAction({
                slug,
                clientId,
                versionId,
                rev,
                changelog,
                note,
                acknowledged: [...seen],
              });
              if (!r.ok) return setError(r.error);
              router.push(doneHref as never);
              router.refresh();
            })
          }
        >
          <BadgeCheck aria-hidden />
          Approve and publish v{number}
        </Button>
        {inReview ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="return-comment">Comment for whoever prepared it</Label>
              <Input
                id="return-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="w-72"
              />
            </div>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await returnToDraftAction({
                    slug,
                    clientId,
                    versionId,
                    ...(comment.trim() ? { comment } : {}),
                  });
                  if (!r.ok) return setError(r.error);
                  router.refresh();
                })
              }
            >
              <Undo2 aria-hidden />
              {comment.trim() ? "Send back with comment" : "Withdraw from review"}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
