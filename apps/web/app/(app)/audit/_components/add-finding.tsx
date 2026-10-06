"use client";

import type { AuditChannel, FindingArea, Level } from "@forgecy/core";
import { Button, Input, Label } from "@forgecy/ui";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addFindingAction } from "../actions";
import { areaLabel, levelLabel } from "../_lib/labels";
import { selectClass, textareaClass } from "../_lib/styles";

/** Write an observation (or a problem) by hand; a person wrote it, so it is already accepted. */
export function AddFinding({
  auditId,
  areas,
  channel,
  kind = "observation",
  observations = [],
  sources = [],
}: {
  auditId: string;
  areas: FindingArea[];
  channel?: AuditChannel;
  kind?: "observation" | "problem";
  /** Problems: accepted observations to link. */
  observations?: Array<{ id: string; title: string }>;
  /** Evidence a person can pick (pages, screenshots, files). */
  sources?: Array<{
    id: string;
    label: string;
    url?: string | null;
    type?: "page" | "screenshot" | "file_row";
  }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!open)
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        {kind === "problem" ? "Add a problem" : "Add an observation"}
      </Button>
    );
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-subtle bg-surface p-5"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const v = (k: string) => String(f.get(k) ?? "").trim();
        const picked = f.getAll("source").map(String);
        const evidence = sources
          .filter((s) => picked.includes(s.id))
          .map((s) => ({
            type: s.type ?? ("page" as const),
            sourceId: s.id,
            label: s.label,
            ...(s.url ? { url: s.url } : {}),
          }));
        start(async () => {
          setError(null);
          const res = await addFindingAction({
            auditId,
            kind,
            area: (v("area") || areas[0]) as FindingArea,
            ...(channel ? { channel } : {}),
            title: v("title"),
            ...(v("description") ? { description: v("description") } : {}),
            ...(v("impact") ? { impact: v("impact") } : {}),
            ...(v("recommendation") ? { recommendation: v("recommendation") } : {}),
            priority: (v("priority") || "medium") as Level,
            evidence,
            parentIds: f.getAll("parent").map(String),
          });
          if (!res.ok) return setError(res.error);
          setOpen(false);
          router.refresh();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {areas.length > 1 ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor={`area-${auditId}`}>Area</Label>
            <select id={`area-${auditId}`} name="area" className={selectClass}>
              {areas.map((a) => (
                <option key={a} value={a}>
                  {areaLabel[a]}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          <Label htmlFor={`priority-${auditId}`}>Priority</Label>
          <select
            id={`priority-${auditId}`}
            name="priority"
            className={selectClass}
            defaultValue="medium"
          >
            {(["high", "medium", "low"] as const).map((l) => (
              <option key={l} value={l}>
                {levelLabel[l]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`title-new-${auditId}`}>Title</Label>
        <Input id={`title-new-${auditId}`} name="title" required maxLength={160} />
      </div>
      {(
        [
          ["description", "Description"],
          ["impact", "Why it matters"],
          ["recommendation", "What to do"],
        ] as const
      ).map(([name, label]) => (
        <div key={name} className="flex flex-col gap-1">
          <Label htmlFor={`${name}-new-${auditId}`}>{label}</Label>
          <textarea
            id={`${name}-new-${auditId}`}
            name={name}
            maxLength={1000}
            className={textareaClass}
          />
        </div>
      ))}
      {kind === "problem" ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-label text-fg-muted">Observations it is based on</legend>
          {observations.length ? (
            observations.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-body-sm">
                <input type="checkbox" name="parent" value={o.id} />
                {o.title}
              </label>
            ))
          ) : (
            <p className="text-body-sm text-warning">Accept at least one observation first.</p>
          )}
        </fieldset>
      ) : sources.length ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-label text-fg-muted">Evidence</legend>
          {sources.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-body-sm">
              <input type="checkbox" name="source" value={s.id} />
              {s.label}
            </label>
          ))}
        </fieldset>
      ) : null}
      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
