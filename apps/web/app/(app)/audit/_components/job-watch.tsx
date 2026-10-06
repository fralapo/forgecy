"use client";

import type { MessageRef } from "@forgecy/core";
import { Badge } from "@forgecy/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useRefText } from "@/lib/use-format";

export interface WatchedJob {
  id: string;
  kind: string;
  label: string;
  status: string;
  progress: number;
  error: string | null;
  errorRef?: MessageRef | null;
}

const ACTIVE = new Set(["queued", "running", "retrying"]);
const STATUSES = new Set([...ACTIVE, "completed", "failed", "cancelled", "needs_attention"]);
type JobStatus =
  "queued" | "running" | "retrying" | "completed" | "failed" | "cancelled" | "needs_attention";

/**
 * Live state of the audit jobs (SSE). When a job ends the page refreshes, so new
 * observations, competitors or pages appear without reloading by hand.
 */
export function JobWatch({ jobs }: { jobs: WatchedJob[] }) {
  const router = useRouter();
  const t = useTranslations("audit.jobWatch");
  const te = useTranslations("enums.jobStatus");
  const refText = useRefText();
  const [live, setLive] = useState(jobs);
  const [seen, setSeen] = useState(jobs);
  if (seen !== jobs) {
    // New server data (after a refresh): restart from it.
    setSeen(jobs);
    setLive(jobs);
  }

  useEffect(() => {
    const sources = jobs
      .filter((j) => ACTIVE.has(j.status))
      .map((job) => {
        const source = new EventSource(`/api/jobs/${job.id}/events`);
        source.addEventListener("job", (e) => {
          const event = JSON.parse((e as MessageEvent<string>).data) as {
            status: string;
            progress?: number;
            error?: string | null;
            errorRef?: MessageRef | null;
          };
          setLive((prev) =>
            prev.map((j) =>
              j.id === job.id
                ? {
                    ...j,
                    status: event.status,
                    progress: event.progress ?? j.progress,
                    error: event.error ?? j.error,
                    errorRef: event.errorRef ?? j.errorRef ?? null,
                  }
                : j,
            ),
          );
          if (!ACTIVE.has(event.status)) {
            source.close();
            router.refresh();
          }
        });
        source.addEventListener("error", () => source.close());
        return source;
      });
    return () => sources.forEach((s) => s.close());
  }, [jobs, router]);

  const shown = live.filter(
    (j) => ACTIVE.has(j.status) || j.status === "failed" || j.status === "needs_attention",
  );
  if (!shown.length) return null;
  return (
    <ul aria-live="polite" className="flex flex-col gap-2">
      {shown.map((j) => (
        <li
          key={j.id}
          className="flex flex-wrap items-center gap-3 rounded-md border border-subtle bg-surface px-4 py-3 text-body-sm"
        >
          <span className="font-medium text-fg">{j.label}</span>
          <Badge
            variant={
              ACTIVE.has(j.status) ? "info" : j.status === "needs_attention" ? "warning" : "error"
            }
          >
            {(() => {
              const status = STATUSES.has(j.status) ? te(j.status as JobStatus) : j.status;
              return j.status === "running" && j.progress > 0
                ? t("progress", { status, percent: j.progress })
                : status;
            })()}
          </Badge>
          {j.error && !ACTIVE.has(j.status) ? (
            <span className="text-fg-muted">{refText(j.errorRef, j.error)}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
