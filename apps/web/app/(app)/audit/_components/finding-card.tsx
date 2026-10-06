"use client";

import type { AuditEvidence, FindingArea, FindingStatus, Level } from "@forgecy/core";
import { Badge, Button, cn, Input, Label } from "@forgecy/ui";
import {
  Bot,
  Check,
  FileText,
  Image as ImageIcon,
  Pencil,
  Quote,
  RotateCcw,
  Trash2,
  User,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  deleteFindingAction,
  editFindingAction,
  reopenFindingAction,
  reviewFindingAction,
  setPriorityAction,
} from "../actions";
import {
  agentLabel,
  areaLabel,
  findingStatusLabel,
  findingStatusVariant,
  levelLabel,
} from "../_lib/labels";
import { selectClass, textareaClass } from "../_lib/styles";

export interface FindingView {
  id: string;
  kind: "observation" | "problem" | "comparison";
  area: FindingArea;
  title: string;
  description: string | null;
  impact: string | null;
  recommendation: string | null;
  priority: Level;
  suggestedPriority: Level | null;
  confidence: Level;
  confidenceReason: string | null;
  status: FindingStatus;
  evidence: AuditEvidence[];
  authorAgent: string | null;
  model: string | null;
  rev: number;
  rejectedReason: string | null;
  stale: boolean;
  /** "From an earlier reading" for website observations of an older scan. */
  olderReading?: boolean;
}

/** Links for evidence sources (signed screenshot URLs), keyed by source id. */
export type SourceLinks = Record<string, { href: string | null; label: string }>;

const evidenceIcon = { quote: Quote, screenshot: ImageIcon } as const;

export function FindingCard({
  finding,
  sources = {},
  readOnly = false,
}: {
  finding: FindingView;
  sources?: SourceLinks;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | "reject">("view");
  const isAi = Boolean(finding.authorAgent);
  const toReview = finding.status === "observed";

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Operation failed");
      else {
        setMode("view");
        router.refresh();
      }
    });

  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-lg bg-surface p-5 text-fg",
        isAi && toReview ? "border-2 border-dashed border-primary" : "border border-subtle",
        finding.status === "rejected" && "opacity-70",
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex flex-wrap items-center gap-2 text-label text-fg-muted">
            <span className="uppercase">{areaLabel[finding.area]}</span>
            {finding.olderReading ? <Badge>From an earlier reading</Badge> : null}
            {finding.stale ? <Badge variant="warning">To recheck</Badge> : null}
          </p>
          <h3 className="text-heading-sm text-fg">{finding.title}</h3>
          <p className="flex items-center gap-1 text-body-sm text-fg-muted">
            {isAi ? (
              <>
                <Bot aria-hidden className="size-4" />
                Proposed by {agentLabel[finding.authorAgent!] ?? finding.authorAgent}
                {finding.model ? (
                  <code className="ml-1 font-mono text-fg-muted">{finding.model}</code>
                ) : null}
              </>
            ) : (
              <>
                <User aria-hidden className="size-4" />
                Written by a person
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={findingStatusVariant[finding.status]}>
            {findingStatusLabel[finding.status]}
          </Badge>
          <Badge
            variant={
              finding.confidence === "high"
                ? "success"
                : finding.confidence === "medium"
                  ? "warning"
                  : "neutral"
            }
            title={finding.confidenceReason ?? undefined}
          >
            {levelLabel[finding.confidence]} confidence
          </Badge>
        </div>
      </header>

      {mode === "edit" ? (
        <EditForm
          finding={finding}
          pending={pending}
          onCancel={() => setMode("view")}
          onSave={(values) =>
            run(() => editFindingAction({ id: finding.id, rev: finding.rev, ...values }))
          }
        />
      ) : (
        <div className="flex flex-col gap-2 text-body-md">
          {finding.description ? <p>{finding.description}</p> : null}
          {finding.impact ? (
            <p className="text-body-sm">
              <span className="font-medium">Why it matters: </span>
              {finding.impact}
            </p>
          ) : null}
          {finding.recommendation ? (
            <p className="text-body-sm">
              <span className="font-medium">What to do: </span>
              {finding.recommendation}
            </p>
          ) : null}
          {finding.confidenceReason ? (
            <p className="text-body-sm text-fg-muted">{finding.confidenceReason}</p>
          ) : null}
          {finding.rejectedReason ? (
            <p className="text-body-sm text-fg-muted">
              Reason for rejection: {finding.rejectedReason}
            </p>
          ) : null}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-label uppercase text-fg-muted">Evidence</p>
        {finding.evidence.length ? (
          <ul className="flex flex-col gap-1">
            {finding.evidence.map((e, i) => {
              const Icon = evidenceIcon[e.type as keyof typeof evidenceIcon] ?? FileText;
              const link = e.sourceId ? sources[e.sourceId] : undefined;
              const href = link?.href ?? e.url ?? null;
              return (
                <li
                  key={`${e.sourceId ?? e.label}-${i}`}
                  className="flex items-start gap-2 text-body-sm"
                >
                  <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                  <span className="min-w-0">
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-link underline underline-offset-2"
                      >
                        {e.label ?? link?.label ?? "Source"}
                      </a>
                    ) : (
                      <span>{e.label ?? link?.label ?? "Source"}</span>
                    )}
                    {e.quote ? <q className="ml-1 text-fg-muted">{e.quote}</q> : null}
                    {e.capturedAt ? (
                      <span className="ml-1 text-fg-muted">· {e.capturedAt.slice(0, 10)}</span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-body-sm text-warning">No evidence: verify before accepting.</p>
        )}
      </div>

      {mode === "reject" ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
            run(() =>
              reviewFindingAction({ id: finding.id, decision: "reject", reason, rev: finding.rev }),
            );
          }}
        >
          <Label htmlFor={`reason-${finding.id}`}>
            Why are you rejecting it?{finding.kind === "problem" ? "" : " (optional)"}
          </Label>
          <Input
            id={`reason-${finding.id}`}
            name="reason"
            required={finding.kind === "problem"}
            maxLength={300}
          />
          <div className="flex gap-2">
            <Button type="submit" variant="danger" size="sm" disabled={pending}>
              Reject
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setMode("view")}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {!readOnly && mode === "view" ? (
        <footer className="flex flex-wrap items-center gap-2 border-t border-subtle pt-3">
          {toReview ? (
            <>
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    reviewFindingAction({ id: finding.id, decision: "accept", rev: finding.rev }),
                  )
                }
              >
                <Check aria-hidden />
                Accept
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() => setMode("reject")}
              >
                <X aria-hidden />
                Reject
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => run(() => reopenFindingAction(finding.id, finding.rev))}
            >
              <RotateCcw aria-hidden />
              Mark as to review
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => setMode("edit")}>
            <Pencil aria-hidden />
            Edit
          </Button>
          <label className="ml-auto flex items-center gap-2 text-body-sm text-fg-muted">
            Priority
            <select
              className={cn(selectClass, "h-8 w-auto")}
              value={finding.priority}
              disabled={pending}
              onChange={(e) =>
                run(() =>
                  setPriorityAction({
                    id: finding.id,
                    priority: e.target.value as Level,
                    rev: finding.rev,
                  }),
                )
              }
            >
              {(["high", "medium", "low"] as const).map((l) => (
                <option key={l} value={l}>
                  {levelLabel[l]}
                  {finding.suggestedPriority === l && isAi ? " (suggested)" : ""}
                </option>
              ))}
            </select>
          </label>
          {!isAi ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                if (window.confirm("Delete this item?")) run(() => deleteFindingAction(finding.id));
              }}
            >
              <Trash2 aria-hidden />
              Delete
            </Button>
          ) : null}
        </footer>
      ) : null}
      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
    </article>
  );
}

function EditForm({
  finding,
  pending,
  onCancel,
  onSave,
}: {
  finding: FindingView;
  pending: boolean;
  onCancel: () => void;
  onSave: (v: {
    title: string;
    description?: string;
    impact?: string;
    recommendation?: string;
  }) => void;
}) {
  const id = finding.id;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const v = (k: string) => String(f.get(k) ?? "").trim();
        onSave({
          title: v("title"),
          ...(v("description") ? { description: v("description") } : {}),
          ...(v("impact") ? { impact: v("impact") } : {}),
          ...(v("recommendation") ? { recommendation: v("recommendation") } : {}),
        });
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor={`title-${id}`}>Title</Label>
        <Input
          id={`title-${id}`}
          name="title"
          defaultValue={finding.title}
          required
          maxLength={160}
        />
      </div>
      {(
        [
          ["description", "Description", finding.description],
          ["impact", "Why it matters", finding.impact],
          ["recommendation", "What to do", finding.recommendation],
        ] as const
      ).map(([name, label, value]) => (
        <div key={name} className="flex flex-col gap-1">
          <Label htmlFor={`${name}-${id}`}>{label}</Label>
          <textarea
            id={`${name}-${id}`}
            name={name}
            defaultValue={value ?? ""}
            maxLength={1000}
            className={textareaClass}
          />
        </div>
      ))}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
