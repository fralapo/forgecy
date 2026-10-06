"use client";

import { Badge, Button } from "@forgecy/ui";
import { Activity } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

type Status =
  | "idle"
  | "queued"
  | "running"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled"
  | "needs_attention"
  | "error";

/** Enqueues a `system.ping` job and follows it over SSE: proves web → Redis → worker → Postgres. */
export function WorkerCheck() {
  const [status, setStatus] = useState<Status>("idle");
  const t = useTranslations("settings.worker");
  const te = useTranslations("enums.jobStatus");

  async function run() {
    setStatus("queued");
    const res = await fetch("/api/system/ping", { method: "POST" });
    if (!res.ok) return setStatus("error");
    const { jobId } = (await res.json()) as { jobId: string };
    const source = new EventSource(`/api/jobs/${jobId}/events`);
    source.addEventListener("job", (e) => {
      const event = JSON.parse((e as MessageEvent<string>).data) as { status: Status };
      setStatus(event.status);
      if (["completed", "failed", "cancelled", "needs_attention"].includes(event.status))
        source.close();
    });
    source.addEventListener("error", () => source.close());
  }

  const variant =
    status === "completed"
      ? "success"
      : ["failed", "error", "needs_attention"].includes(status)
        ? "error"
        : "neutral";
  return (
    <div className="mt-4 flex items-center gap-3">
      <Button
        variant="secondary"
        onClick={() => void run()}
        disabled={status === "queued" || status === "running"}
      >
        <Activity aria-hidden />
        {t("check")}
      </Button>
      <span aria-live="polite">
        {status === "idle" ? null : (
          <Badge variant={variant}>
            {status === "completed" || status === "error" ? t(status) : te(status)}
          </Badge>
        )}
      </span>
    </div>
  );
}
