"use client";

import { Button, Input, Label } from "@forgecy/ui";
import { FlaskConical, Power, PowerOff, Save, Send, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import type { AdminActionResult } from "../../settings/_lib/admin-action";
import { controlClass } from "../../content/_components/action-button";
import {
  previewAgentAction,
  type PreviewActionResult,
  discardAgentDraftAction,
  publishAgentDraftAction,
  saveAgentDraftAction,
  saveAgentRoutesAction,
  setAgentActiveAction,
} from "../actions";

function Message({ result }: { result: AdminActionResult | null }) {
  return (
    <p aria-live="polite" className="min-h-5 text-body-sm">
      {result && !result.ok ? <span className="text-error">{result.error}</span> : null}
      {result?.ok ? <span className="text-success">{result.message}</span> : null}
    </p>
  );
}

/** “Deactivate agent” (typed key, spec page 55) and “Activate agent”. */
export function ActivationForm({
  agent,
  name,
  active,
}: {
  agent: string;
  name: string;
  active: boolean;
}) {
  const t = useTranslations("agents.activation");
  const [result, setResult] = useState<AdminActionResult | null>(null);
  const [pending, start] = useTransition();
  const [typed, setTyped] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const submit = (next: boolean) =>
    start(async () => {
      const res = await setAgentActiveAction(agent, next, next ? undefined : typed);
      setResult(res);
      if (res.ok) {
        setOpen(false);
        setTyped("");
      }
    });
  return (
    <div className="grid gap-3">
      {active ? (
        <Button variant="danger" className="w-fit" onClick={() => setOpen(true)}>
          <PowerOff aria-hidden />
          {t("deactivate")}
        </Button>
      ) : (
        <Button className="w-fit" disabled={pending} onClick={() => submit(true)}>
          <Power aria-hidden />
          {t("activate")}
        </Button>
      )}
      <Message result={result} />
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        aria-labelledby="agent-off-title"
        className="m-auto w-full max-w-md rounded-lg border border-subtle bg-surface p-6 text-fg backdrop:bg-fg/40"
      >
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit(false);
          }}
        >
          <h2 id="agent-off-title" className="text-heading-sm">
            {t("confirmTitle", { name })}
          </h2>
          <p className="text-body-md text-fg-muted">{t("confirmBody")}</p>
          <div className="grid gap-1">
            <Label htmlFor="agent-off-key">{t("typeKey", { key: agent })}</Label>
            <Input
              id="agent-off-key"
              value={typed}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
          {result && !result.ok ? (
            <p role="alert" className="text-body-sm text-error">
              {result.error}
            </p>
          ) : null}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" variant="danger" disabled={pending || typed.trim() !== agent}>
              {t("deactivate")}
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

export interface TaskRouteRow {
  task: string;
  label: string;
  provider: string;
  model: string;
}

export interface TextProviderOption {
  id: string;
  name: string;
  ready: boolean;
  defaultModel: string;
}

/** “Tasks and models”: one service and model per task, or the AI settings. */
export function RoutesForm({
  agent,
  rows,
  providers,
}: {
  agent: string;
  rows: TaskRouteRow[];
  providers: TextProviderOption[];
}) {
  const t = useTranslations("agents.tasks");
  const tc = useTranslations("common");
  const [result, setResult] = useState<AdminActionResult | null>(null);
  const [pending, start] = useTransition();
  const [chosen, setChosen] = useState(() =>
    Object.fromEntries(rows.map((r) => [r.task, r.provider])),
  );
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        start(async () => setResult(await saveAgentRoutesAction(agent, form)));
      }}
    >
      <ul className="grid gap-4">
        {rows.map((r) => (
          <li key={r.task} className="grid items-end gap-3 sm:grid-cols-[12rem_1fr_1fr]">
            <span className="text-body-sm text-fg">{r.label}</span>
            <div className="grid gap-1">
              <Label htmlFor={`ag-${r.task}-provider`}>{t("provider")}</Label>
              <select
                id={`ag-${r.task}-provider`}
                name={`${r.task}.provider`}
                value={chosen[r.task] ?? "default"}
                onChange={(e) => setChosen({ ...chosen, [r.task]: e.target.value })}
                className={controlClass}
              >
                <option value="default">{t("default")}</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.ready ? p.name : t("notReady", { name: p.name })}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`ag-${r.task}-model`}>{t("model")}</Label>
              <Input
                id={`ag-${r.task}-model`}
                name={`${r.task}.model`}
                defaultValue={r.model}
                maxLength={200}
                disabled={(chosen[r.task] ?? "default") === "default"}
                placeholder={providers.find((p) => p.id === chosen[r.task])?.defaultModel ?? ""}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="text-body-sm text-fg-muted">{t("modelHint")}</p>
      <Message result={result} />
      <Button type="submit" disabled={pending} className="w-fit">
        <Save aria-hidden />
        {tc("actions.save")}
      </Button>
    </form>
  );
}

/** Draft of the next instructions version: save, publish with changelog, discard. */
export function InstructionsForm({
  agent,
  version,
  initial,
  hasDraft,
  max,
  preview,
}: {
  agent: string;
  version: number;
  initial: string;
  hasDraft: boolean;
  max: number;
  preview?: PreviewOptions;
}) {
  const t = useTranslations("agents.instructions");
  const [text, setText] = useState(initial);
  const [changelog, setChangelog] = useState("");
  const [result, setResult] = useState<AdminActionResult | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<AdminActionResult>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      setResult(res);
      if (res.ok) after?.();
    });
  return (
    <div className="grid gap-4">
      <h3 className="text-heading-sm text-fg">{t("draftTitle", { version })}</h3>
      <div className="grid gap-1">
        <Label htmlFor="ag-text">{t("text")}</Label>
        <textarea
          id="ag-text"
          rows={8}
          maxLength={max}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={`${controlClass} font-mono`}
          aria-describedby="ag-text-hint"
        />
        <p id="ag-text-hint" className="text-body-sm text-fg-muted">
          {t("textHint", { max })}
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => act(() => saveAgentDraftAction(agent, text))}
        >
          <Save aria-hidden />
          {t("saveDraft")}
        </Button>
        {hasDraft ? (
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              act(
                () => discardAgentDraftAction(agent),
                () => setText(""),
              )
            }
          >
            <Trash2 aria-hidden />
            {t("discard")}
          </Button>
        ) : null}
      </div>
      <div className="grid gap-1">
        <Label htmlFor="ag-changelog">{t("changelogLabel")}</Label>
        <textarea
          id="ag-changelog"
          rows={2}
          maxLength={500}
          value={changelog}
          onChange={(e) => setChangelog(e.target.value)}
          className={controlClass}
        />
        <p className="text-body-sm text-fg-muted">{t("changelogHint")}</p>
      </div>
      <Message result={result} />
      <Button
        className="w-fit"
        disabled={pending || changelog.trim().length < 3}
        onClick={() =>
          act(
            () => publishAgentDraftAction(agent, text, changelog),
            () => setChangelog(""),
          )
        }
      >
        <Send aria-hidden />
        {t("publish", { version })}
      </Button>
      {preview ? (
        <PreviewPanel agent={agent} version={version} text={text} options={preview} />
      ) : null}
    </div>
  );
}

export interface PreviewOptions {
  tasks: Array<{ value: string; label: string; estimate: string }>;
  /** Why trying is not available (no_ai, no task); null when it is. */
  unavailable: string | null;
  exampleMax: number;
}

/** “Try on an example”: runs the draft as it is in the editor, unsaved changes included. */
function PreviewPanel({
  agent,
  version,
  text,
  options,
}: {
  agent: string;
  version: number;
  text: string;
  options: PreviewOptions;
}) {
  const t = useTranslations("agents.preview");
  const [task, setTask] = useState(options.tasks[0]?.value ?? "");
  const [example, setExample] = useState("");
  const [result, setResult] = useState<PreviewActionResult | null>(null);
  const [pending, start] = useTransition();
  const chosen = options.tasks.find((x) => x.value === task);
  return (
    <section aria-labelledby="ag-preview-title" className="grid gap-4 border-t border-subtle pt-6">
      <h3 id="ag-preview-title" className="text-heading-sm text-fg">
        {t("title")}
      </h3>
      <p className="text-body-sm text-fg-muted">{t("intro")}</p>
      {options.unavailable ? (
        <p className="text-body-sm text-fg">{options.unavailable}</p>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setResult(null);
            start(async () =>
              setResult(await previewAgentAction(agent, { task, example, text, version })),
            );
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor="ag-preview-task">{t("task")}</Label>
            <select
              id="ag-preview-task"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              className={controlClass}
            >
              {options.tasks.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ag-preview-example">{t("example")}</Label>
            <textarea
              id="ag-preview-example"
              rows={5}
              maxLength={options.exampleMax}
              value={example}
              onChange={(e) => setExample(e.target.value)}
              className={controlClass}
              aria-describedby="ag-preview-hint"
            />
            <p id="ag-preview-hint" className="text-body-sm text-fg-muted">
              {t("exampleHint", { max: options.exampleMax })}
            </p>
          </div>
          {chosen ? <p className="text-body-sm text-fg-muted">{chosen.estimate}</p> : null}
          <Button
            type="submit"
            variant="secondary"
            className="w-fit"
            disabled={pending || example.trim().length < 3}
          >
            <FlaskConical aria-hidden />
            {pending ? t("running") : t("run")}
          </Button>
        </form>
      )}
      <div aria-live="polite">
        {result && !result.ok ? <p className="text-body-sm text-error">{result.error}</p> : null}
        {result?.ok ? (
          <div className="grid gap-3 rounded-md border border-subtle p-4">
            <h4 className="text-label text-fg">{t("resultTitle")}</h4>
            <p className="whitespace-pre-wrap text-body-md text-fg">{result.output}</p>
            {result.followed.length ? (
              <>
                <h4 className="text-label text-fg">{t("followed")}</h4>
                <ul className="grid list-disc gap-1 pl-5 text-body-sm text-fg">
                  {result.followed.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <p className="text-body-sm text-fg-muted">{result.meta}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
