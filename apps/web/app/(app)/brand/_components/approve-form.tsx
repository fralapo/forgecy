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
          <legend className="text-heading-sm text-fg">Controlli aperti</legend>
          <p className="text-body-sm text-fg-muted">
            Nessun controllo blocca: conferma di averli visti uno per uno.
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
                  <span className="text-warning">Ho visto:</span> {c.message}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : (
        <p className="text-body-sm text-success">Nessun controllo aperto.</p>
      )}

      <div className="space-y-1">
        <Label htmlFor="changelog">Changelog</Label>
        <textarea
          id="changelog"
          rows={3}
          className={controlClass}
          value={changelog}
          onChange={(e) => setChangelog(e.target.value)}
          placeholder="Che cosa cambia in questa versione e perché"
        />
        <p className="text-body-sm text-fg-muted">
          Almeno {CHANGELOG_MIN} caratteri: resta nella cronologia.
        </p>
      </div>
      {selfApproval ? (
        <div className="space-y-1">
          <Label htmlFor="self-note">Nota di approvazione</Label>
          <Input id="self-note" value={note} onChange={(e) => setNote(e.target.value)} />
          <p className="text-body-sm text-fg-muted">
            Stai approvando una bozza che hai preparato tu: scrivi una nota per la cronologia.
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
          Approva e pubblica la v{number}
        </Button>
        {inReview ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="return-comment">Commento per chi l&apos;ha preparata</Label>
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
              {comment.trim() ? "Rimanda con commento" : "Ritira dalla revisione"}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
