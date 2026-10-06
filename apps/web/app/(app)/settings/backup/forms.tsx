"use client";

import { Button, Input, Label } from "@forgecy/ui";
import { Archive, History, SearchCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { useFormat } from "@/lib/use-format";
import { ActionFeedback } from "../_components/action-feedback";
import type { AdminActionResult } from "../_lib/admin-action";
import {
  checkRestoreAction,
  createBackupAction,
  deleteBackupAction,
  setNightlyAction,
  startRestoreAction,
  type RestoreCheck,
} from "./actions";

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

export interface RestoreChoice {
  name: string;
  label: string;
}

/**
 * Restore flow (spec Flow K): choose → validate → impact → typed agency name → start.
 * The server checks the backup and the name again before it enqueues anything.
 */
export function RestoreForm({
  choices,
  agency,
  impact,
  busy,
}: {
  choices: RestoreChoice[];
  agency: string;
  impact: string;
  busy: boolean;
}) {
  const t = useTranslations("admin.backup.restore");
  const tList = useTranslations("admin.backup.list");
  const { pending, result, run } = useAction();
  const [name, setName] = useState("");
  const [checking, startCheck] = useTransition();
  const [check, setCheck] = useState<RestoreCheck | null>(null);
  const [typed, setTyped] = useState("");
  const valid = check?.ok === true && check.problems.length === 0;
  const matches = typed.trim().toLocaleLowerCase() === agency.trim().toLocaleLowerCase();
  const confirmId = "restore-confirm";

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="restore-backup">{t("choose")}</Label>
          <select
            id="restore-backup"
            className="rounded-md border border-control bg-surface px-3 py-2 text-body-sm text-fg focus-visible:outline-2 focus-visible:outline-focus"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setCheck(null);
              setTyped("");
            }}
          >
            <option value="">{t("choosePlaceholder")}</option>
            {choices.map((c) => (
              <option key={c.name} value={c.name}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={!name || checking || busy}
          onClick={() => startCheck(async () => setCheck(await checkRestoreAction(name)))}
        >
          <SearchCheck aria-hidden className="size-4" />
          {t("check")}
        </Button>
      </div>
      {checking ? (
        <p role="status" className="text-body-sm text-fg-muted">
          {t("checking")}
        </p>
      ) : null}
      {check && !check.ok ? <ActionFeedback result={check} /> : null}
      {check?.ok ? <CheckSummary check={check} impact={impact} /> : null}
      {valid ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => startRestoreAction(name, typed));
          }}
        >
          <Label htmlFor={confirmId} className="font-normal">
            {t("confirmLabel", { name: agency })}
          </Label>
          <Input
            id={confirmId}
            value={typed}
            autoComplete="off"
            onChange={(e) => setTyped(e.target.value)}
            className="max-w-sm"
          />
          <Button
            type="submit"
            variant="danger"
            className="self-start"
            disabled={!matches || pending || busy}
          >
            <History aria-hidden className="size-4" />
            {t("submit")}
          </Button>
          <ActionFeedback result={result} />
        </form>
      ) : null}
      {choices.length === 0 ? <p className="text-body-sm text-fg-muted">{tList("empty")}</p> : null}
    </div>
  );
}

function CheckSummary({
  check,
  impact,
}: {
  check: Extract<RestoreCheck, { ok: true }>;
  impact: string;
}) {
  const t = useTranslations("admin.backup.restore");
  const tList = useTranslations("admin.backup.list");
  const format = useFormat();
  if (check.problems.length > 0)
    return (
      <ul role="alert" className="flex flex-col gap-1 text-body-sm text-error">
        {check.problems.map((p) => (
          <li key={p}>{t(`problem.${p}`)}</li>
        ))}
      </ul>
    );
  return (
    <div role="status" className="flex flex-col gap-1 text-body-sm text-fg">
      <p className="text-success">{t("valid")}</p>
      <p>
        {t("summary", {
          date: check.createdAt ? format.date(check.createdAt, "dateTime") : t("unknown"),
          scope: tList(check.media ? "scopeFull" : "scopeDb"),
          version: check.appVersion ?? t("unknown"),
          migration: check.lastMigration ?? t("unknown"),
        })}
      </p>
      <p>{t("migrations", { count: check.migrationsToApply })}</p>
      <p>{impact}</p>
    </div>
  );
}
