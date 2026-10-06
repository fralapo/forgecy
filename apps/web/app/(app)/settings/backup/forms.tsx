"use client";

import { Button, Label } from "@forgecy/ui";
import { Archive, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { ActionFeedback } from "../_components/action-feedback";
import type { AdminActionResult } from "../_lib/admin-action";
import { createBackupAction, deleteBackupAction, setNightlyAction } from "./actions";

/** While a backup runs, reload the page data every few seconds to show progress and the result. */
export function RefreshWhileRunning({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [active, router]);
  return null;
}

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AdminActionResult | null>(null);
  const run = (fn: () => Promise<AdminActionResult>) =>
    start(async () => {
      const res = await fn();
      setResult(res);
      router.refresh();
    });
  return { pending, result, run };
}

export function CreateBackupForm({ running }: { running: number | null }) {
  const t = useTranslations("admin.backup.create");
  const { pending, result, run } = useAction();
  return (
    <form
      className="mt-4 flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const media = new FormData(e.currentTarget).get("media") === "on";
        run(() => createBackupAction(media));
      }}
    >
      <label className="flex items-center gap-2 text-body-sm text-fg">
        <input type="checkbox" checked disabled aria-describedby="backup-db-note" />
        {t("database")}
      </label>
      <span id="backup-db-note" className="sr-only">
        {t("databaseRequired")}
      </span>
      <Label className="flex items-center gap-2 font-normal">
        <input type="checkbox" name="media" defaultChecked />
        {t("media")}
      </Label>
      <Button type="submit" className="self-start" disabled={pending || running !== null}>
        <Archive aria-hidden className="size-4" />
        {t("submit")}
      </Button>
      {running !== null ? (
        <p role="status" className="text-body-sm text-fg">
          {t("running", { progress: running })}
        </p>
      ) : null}
      <ActionFeedback result={result} />
    </form>
  );
}

export function NightlySwitch({ enabled }: { enabled: boolean }) {
  const t = useTranslations("admin.backup.nightly");
  const { pending, result, run } = useAction();
  return (
    <div className="mt-4 flex flex-col gap-2">
      <Button
        type="button"
        variant="secondary"
        className="self-start"
        disabled={pending}
        onClick={() => {
          if (enabled && !window.confirm(t("confirmOff"))) return;
          run(() => setNightlyAction(!enabled));
        }}
      >
        {t(enabled ? "turnOff" : "turnOn")}
      </Button>
      <ActionFeedback result={result} />
    </div>
  );
}

export function DeleteBackupButton({ name }: { name: string }) {
  const t = useTranslations("admin.backup.list");
  const { pending, result, run } = useAction();
  return (
    <>
      <button
        type="button"
        className="inline-flex items-center gap-1 text-error underline disabled:opacity-50"
        disabled={pending}
        onClick={() => {
          if (window.confirm(t("confirmDelete", { name }))) run(() => deleteBackupAction(name));
        }}
      >
        <Trash2 aria-hidden className="size-4" />
        {t("delete")}
      </button>
      {result && !result.ok ? <ActionFeedback result={result} /> : null}
    </>
  );
}
