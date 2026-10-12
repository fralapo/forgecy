"use client";

import {
  CLIENT_SLUG_PATTERN,
  templateConflictId,
  type ClientImportConflict,
  type ClientImportResolved,
} from "@forgecy/core";
import { Button, Input, Label } from "@forgecy/ui";
import { ArrowLeft, Download, TriangleAlert, X } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { ActionFeedback } from "../_components/action-feedback";
import type { AdminActionResult } from "../_lib/admin-action";
import { cancelClientImportAction, confirmClientImportAction } from "./actions";
import { Stepper } from "./stepper";

type Choice = "useExisting" | "importDraft";

/** Steps Conflicts and Confirm (spec page 68): a choice per conflict, then the summary. */
export function ImportWizard({
  importId,
  pkgClient,
  conflicts,
  resolved,
  replaceCounts,
}: {
  importId: string;
  pkgClient: { name: string; slug: string };
  conflicts: ClientImportConflict[];
  resolved: ClientImportResolved[];
  /** What the existing client has today, for the replacement warning. */
  replaceCounts: { versions: number; carousels: number; audits: number } | null;
}) {
  const t = useTranslations("clientTransfer.import");
  const format = useFormatter();
  const router = useRouter();
  const clientConflict = conflicts.find((c) => c.kind === "client");
  const templateConflicts = conflicts.filter((c) => c.kind === "template");
  const [step, setStep] = useState<"conflicts" | "confirm">(
    conflicts.length ? "conflicts" : "confirm",
  );
  const [mode, setMode] = useState<"new" | "replace" | null>(clientConflict ? null : "new");
  const [slug, setSlug] = useState(clientConflict?.proposedSlug ?? pkgClient.slug);
  const [templates, setTemplates] = useState<Record<string, Choice>>({});
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<AdminActionResult | null>(null);
  const [pending, start] = useTransition();

  const slugOk = mode !== "new" || CLIENT_SLUG_PATTERN.test(slug);
  const open =
    (mode === null ? 1 : 0) +
    templateConflicts.filter((c) => !templates[templateConflictId(c.key, c.version)]).length;
  const drafts = Object.values(templates).filter((c) => c === "importDraft").length;
  const target = clientConflict?.existingName ?? "";
  const canImport = open === 0 && slugOk && (mode !== "replace" || typed.trim() === target.trim());

  const steps = [t("steps.file"), t("steps.verify"), t("steps.conflicts"), t("steps.confirm")];
  const cancel = () =>
    start(async () => {
      const r = await cancelClientImportAction(importId);
      if (r.ok) router.push("/settings/import-export?tab=import" as Route);
      else setResult(r);
    });

  return (
    <div className="grid gap-5">
      <Stepper
        label={t("stepsLabel")}
        steps={steps}
        current={step === "conflicts" ? 2 : 3}
        states={{
          done: t("stepState.done"),
          current: t("stepState.current"),
          todo: t("stepState.todo"),
        }}
      />

      {step === "conflicts" ? (
        <>
          <p aria-live="polite" className="text-body-sm text-fg">
            {t("conflicts.counter", { open, auto: resolved.length })}
          </p>
          {clientConflict ? (
            <fieldset className="grid gap-3 rounded-md border border-subtle p-4">
              <legend className="px-1 text-label text-fg">
                {t("conflicts.clientLegend", {
                  name: clientConflict.name,
                  existing: clientConflict.existingName,
                })}
              </legend>
              <label className="flex items-center gap-2 text-body-sm text-fg">
                <input
                  type="radio"
                  name="ie-client-mode"
                  checked={mode === "new"}
                  onChange={() => setMode("new")}
                />
                {t("conflicts.asNew")}
              </label>
              {mode === "new" ? (
                <div className="grid gap-1 pl-6">
                  <Label htmlFor="ie-slug">{t("conflicts.slug")}</Label>
                  <Input
                    id="ie-slug"
                    value={slug}
                    aria-describedby="ie-slug-hint"
                    aria-invalid={!slugOk}
                    onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  />
                  <p id="ie-slug-hint" className="text-body-sm text-fg-muted">
                    {t("conflicts.slugHint", { slug: slug || "…" })}
                  </p>
                </div>
              ) : null}
              <label className="flex items-start gap-2 text-body-sm text-fg">
                <input
                  type="radio"
                  name="ie-client-mode"
                  className="mt-1"
                  checked={mode === "replace"}
                  aria-describedby="ie-replace-hint"
                  onChange={() => setMode("replace")}
                />
                <span>
                  {t("conflicts.replace")}
                  <span id="ie-replace-hint" className="block text-fg-muted">
                    {t("conflicts.replaceHint")}
                  </span>
                </span>
              </label>
            </fieldset>
          ) : null}

          {templateConflicts.map((c) => {
            const id = templateConflictId(c.key, c.version);
            return (
              <fieldset key={id} className="grid gap-3 rounded-md border border-subtle p-4">
                <legend className="px-1 text-label text-fg">
                  {t("conflicts.templateLegend", {
                    name: c.name,
                    key: c.key,
                    version: c.version,
                    versions: format.list(c.existingVersions),
                  })}
                </legend>
                {(["useExisting", "importDraft"] as const).map((choice) => (
                  <label key={choice} className="flex items-center gap-2 text-body-sm text-fg">
                    <input
                      type="radio"
                      name={`ie-tpl-${id}`}
                      checked={templates[id] === choice}
                      onChange={() => setTemplates((prev) => ({ ...prev, [id]: choice }))}
                    />
                    {t(`conflicts.${choice}`)}
                  </label>
                ))}
              </fieldset>
            );
          })}

          {resolved.length ? (
            <details className="rounded-md border border-subtle p-4 text-body-sm">
              <summary className="cursor-pointer text-fg">{t("conflicts.autoTitle")}</summary>
              <ul className="mt-2 grid gap-1 text-fg-muted">
                {resolved.map((r, i) => (
                  <li key={i}>
                    {r.kind === "templateReused"
                      ? t("conflicts.templateReused", { key: r.key, version: r.version })
                      : t(`conflicts.${r.kind}`, { name: r.name, email: r.email })}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={open > 0 || !slugOk} onClick={() => setStep("confirm")}>
              {t("conflicts.next")}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={cancel}>
              <X aria-hidden className="size-4" />
              {t("confirm.cancel")}
            </Button>
          </div>
        </>
      ) : (
        <>
          {!conflicts.length ? (
            <p className="text-body-sm text-fg-muted">{t("conflicts.none")}</p>
          ) : null}
          <ul className="grid list-disc gap-2 pl-5 text-body-sm text-fg">
            {mode === "replace" ? null : (
              <li>{t("confirm.create", { name: pkgClient.name, slug })}</li>
            )}
            {drafts ? <li>{t("confirm.templatesDraft", { count: drafts })}</li> : null}
            <li>{t("confirm.states")}</li>
          </ul>
          {mode === "replace" && replaceCounts ? (
            <div
              role="alert"
              className="grid gap-3 rounded-md border-2 border-danger bg-surface p-4"
            >
              <p className="flex items-start gap-2 text-body-sm text-fg">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-error" />
                {t("confirm.replace", { name: target, ...replaceCounts })}
              </p>
              <div className="grid gap-1">
                <Label htmlFor="ie-typed">{t("confirm.typeName", { name: target })}</Label>
                <Input
                  id="ie-typed"
                  value={typed}
                  autoComplete="off"
                  onChange={(e) => setTyped(e.target.value)}
                />
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {conflicts.length ? (
              <Button type="button" variant="secondary" onClick={() => setStep("conflicts")}>
                <ArrowLeft aria-hidden className="size-4" />
                {t("confirm.back")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant={mode === "replace" ? "danger" : "primary"}
              disabled={!canImport || pending}
              onClick={() =>
                start(async () => {
                  const r = await confirmClientImportAction(
                    importId,
                    {
                      client: mode === "replace" ? { mode: "replace" } : { mode: "new", slug },
                      templates,
                    },
                    mode === "replace" ? typed : undefined,
                  );
                  setResult(r);
                  if (r.ok) router.refresh();
                })
              }
            >
              <Download aria-hidden className="size-4" />
              {t("confirm.submit")}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={cancel}>
              <X aria-hidden className="size-4" />
              {t("confirm.cancel")}
            </Button>
          </div>
        </>
      )}
      <div aria-live="polite">
        <ActionFeedback result={result} />
      </div>
    </div>
  );
}
