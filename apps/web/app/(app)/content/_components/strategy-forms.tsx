"use client";

import {
  channelLabels,
  contentChannels,
  funnelSchema,
  type ContentChannel,
  type Frequency,
  type PillarInputRaw,
  type RubricInputRaw,
} from "@forgecy/content/client";
import { funnelStages } from "@forgecy/core";
import { Button, Input, Label } from "@forgecy/ui";
import { Pencil, Plus, Save, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition, type ReactNode } from "react";
import { savePillarAction, saveRubricAction, type ActionResult } from "../actions";
import { controlClass } from "./action-button";

export interface StrategyOptions {
  audience: { id: string; name: string }[];
  /** Approved catalog products; empty when the catalog is off. */
  products: { id: string; name: string }[];
  templates: { key: string; name: string }[];
  pillars: { id: string; name: string }[];
}

type Option = { value: string; label: string };

/** Runs a save action, shows its error, refreshes the page on success. */
export function useSave() {
  const router = useRouter();
  const t = useTranslations("content.form");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult>, onOk?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) {
        setError(
          r.code === "CONFLICT-DRAFT-REV" ? t("conflictReload", { error: r.error }) : r.error,
        );
        return;
      }
      onOk?.();
      router.refresh();
    });
  return { pending, error, run };
}

export function FormError({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-body-sm text-error">
      {error}
    </p>
  ) : null;
}

/** Text, textarea or select field with its label. */
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
      {hint ? <p className="text-body-sm text-fg-muted">{hint}</p> : null}
    </div>
  );
}

/** Checkbox group: products, audience segments, channels. */
export function Checks({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: Option[];
  value: readonly string[];
  onChange(v: string[]): void;
}) {
  if (!options.length) return null;
  return (
    <fieldset className="space-y-2">
      <legend className="text-label text-fg">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-body-sm text-fg">
            <input
              type="checkbox"
              className="size-4"
              checked={value.includes(o.value)}
              onChange={(e) =>
                onChange(
                  e.target.checked ? [...value, o.value] : value.filter((x) => x !== o.value),
                )
              }
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function FrequencyField({
  value,
  onChange,
}: {
  value: Frequency | null | undefined;
  onChange(v: Frequency | null): void;
}) {
  const id = useId();
  const t = useTranslations("content.form.frequency");
  return (
    <fieldset className="space-y-1">
      <legend className="text-label text-fg">{t("legend")}</legend>
      <div className="flex gap-2">
        <Input
          id={id}
          type="number"
          min={1}
          max={60}
          aria-label={t("count")}
          placeholder="—"
          value={value?.count ?? ""}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10);
            onChange(
              Number.isFinite(n) && n > 0 ? { count: n, unit: value?.unit ?? "week" } : null,
            );
          }}
        />
        <select
          aria-label={t("period")}
          className={controlClass}
          value={value?.unit ?? "week"}
          disabled={!value}
          onChange={(e) =>
            value && onChange({ ...value, unit: e.target.value as Frequency["unit"] })
          }
        >
          <option value="week">{t("week")}</option>
          <option value="month">{t("month")}</option>
        </select>
      </div>
    </fieldset>
  );
}

const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

/** Button that opens the form in place; the form closes on save or “Cancel”. */
export function Toggle({
  label,
  edit,
  children,
}: {
  label: string;
  edit: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (open) return <>{children(() => setOpen(false))}</>;
  return (
    <Button size="sm" variant={edit ? "secondary" : "primary"} onClick={() => setOpen(true)}>
      {edit ? <Pencil aria-hidden /> : <Plus aria-hidden />}
      {label}
    </Button>
  );
}

export function Actions({ pending, onCancel }: { pending: boolean; onCancel(): void }) {
  const t = useTranslations("content.form");
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" disabled={pending}>
        <Save aria-hidden />
        {t("save")}
      </Button>
      <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>
        <X aria-hidden />
        {t("cancel")}
      </Button>
    </div>
  );
}

export const formClass = "w-full space-y-4 rounded-lg border border-subtle bg-surface p-5";

// ---- Pillar ----

export function PillarForm(props: {
  slug: string;
  clientId: string;
  id?: string;
  rev?: number;
  initial?: PillarInputRaw;
  options: StrategyOptions;
  label: string;
}) {
  return (
    <Toggle label={props.label} edit={Boolean(props.id)}>
      {(close) => <PillarFields {...props} onClose={close} />}
    </Toggle>
  );
}

function PillarFields({
  slug,
  clientId,
  id,
  rev,
  initial,
  options,
  onClose,
}: Parameters<typeof PillarForm>[0] & { onClose(): void }) {
  const [v, setV] = useState<PillarInputRaw>(initial ?? { name: "" });
  const [themes, setThemes] = useState((initial?.themes ?? []).join("\n"));
  const [forbidden, setForbidden] = useState((initial?.forbidden ?? []).join("\n"));
  const t = useTranslations("content.strategy.pillarForm");
  const tl = useTranslations("content.labels");
  const { pending, error, run } = useSave();
  const set = (patch: Partial<PillarInputRaw>) => setV((cur) => ({ ...cur, ...patch }));
  return (
    <form
      aria-label={id ? t("editLabel", { name: initial?.name ?? "" }) : t("newLabel")}
      className={formClass}
      onSubmit={(e) => {
        e.preventDefault();
        const values = { ...v, themes: lines(themes), forbidden: lines(forbidden) };
        run(() => savePillarAction({ slug, clientId, id, rev, values }), onClose);
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("name")}>
          {(fid) => (
            <Input
              id={fid}
              required
              maxLength={40}
              value={v.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          )}
        </Field>
        <Field label={t("funnel")}>
          {(fid) => (
            <select
              id={fid}
              className={controlClass}
              value={v.funnel ?? ""}
              onChange={(e) =>
                set({ funnel: e.target.value ? funnelSchema.parse(e.target.value) : null })
              }
            >
              <option value="">{t("funnelNone")}</option>
              {funnelStages.map((k) => (
                <option key={k} value={k}>
                  {tl(`funnel.${k}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("goal")}>
          {(fid) => (
            <Input
              id={fid}
              maxLength={160}
              value={v.goal ?? ""}
              onChange={(e) => set({ goal: e.target.value })}
            />
          )}
        </Field>
        <FrequencyField value={v.frequency} onChange={(frequency) => set({ frequency })} />
        <Field label={t("cta")}>
          {(fid) => (
            <Input
              id={fid}
              maxLength={200}
              value={v.cta ?? ""}
              onChange={(e) => set({ cta: e.target.value })}
            />
          )}
        </Field>
        <Field label={t("emotion")}>
          {(fid) => (
            <Input
              id={fid}
              maxLength={60}
              value={v.emotion ?? ""}
              onChange={(e) => set({ emotion: e.target.value })}
            />
          )}
        </Field>
        <Field label={t("themes")} hint={t("onePerLine")}>
          {(fid) => (
            <textarea
              id={fid}
              rows={3}
              className={controlClass}
              value={themes}
              onChange={(e) => setThemes(e.target.value)}
            />
          )}
        </Field>
        <Field label={t("avoid")} hint={t("onePerLine")}>
          {(fid) => (
            <textarea
              id={fid}
              rows={3}
              className={controlClass}
              value={forbidden}
              onChange={(e) => setForbidden(e.target.value)}
            />
          )}
        </Field>
      </div>
      <Checks
        legend={t("audience")}
        options={options.audience.map((a) => ({ value: a.id, label: a.name }))}
        value={v.audienceIds ?? []}
        onChange={(audienceIds) => set({ audienceIds })}
      />
      <Checks
        legend={t("products")}
        options={options.products.map((p) => ({ value: p.id, label: p.name }))}
        value={v.productIds ?? []}
        onChange={(productIds) => set({ productIds })}
      />
      <FormError error={error} />
      <Actions pending={pending} onCancel={onClose} />
    </form>
  );
}

// ---- Rubric ----

const channelOptions: { value: ContentChannel; label: string }[] = contentChannels.map((c) => ({
  value: c,
  label: channelLabels[c],
}));

export function RubricForm(props: {
  slug: string;
  clientId: string;
  id?: string;
  rev?: number;
  pillarId: string;
  initial?: RubricInputRaw;
  options: StrategyOptions;
  label: string;
}) {
  return (
    <Toggle label={props.label} edit={Boolean(props.id)}>
      {(close) => <RubricFields {...props} onClose={close} />}
    </Toggle>
  );
}

function RubricFields({
  slug,
  clientId,
  id,
  rev,
  pillarId,
  initial,
  options,
  onClose,
}: Parameters<typeof RubricForm>[0] & { onClose(): void }) {
  const [v, setV] = useState<RubricInputRaw>(initial ?? { pillarId, name: "" });
  const t = useTranslations("content.strategy.rubricForm");
  const { pending, error, run } = useSave();
  const set = (patch: Partial<RubricInputRaw>) => setV((cur) => ({ ...cur, ...patch }));
  const text = (key: "hookFormula" | "hookExample" | "cta", label: string) => (
    <Field label={label}>
      {(fid) => (
        <Input
          id={fid}
          maxLength={200}
          value={v[key] ?? ""}
          onChange={(e) => set({ [key]: e.target.value })}
        />
      )}
    </Field>
  );
  return (
    <form
      aria-label={id ? t("editLabel", { name: initial?.name ?? "" }) : t("newLabel")}
      className={formClass}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveRubricAction({ slug, clientId, id, rev, values: v }), onClose);
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("name")}>
          {(fid) => (
            <Input
              id={fid}
              required
              maxLength={40}
              value={v.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          )}
        </Field>
        <Field label={t("pillar")}>
          {(fid) => (
            <select
              id={fid}
              className={controlClass}
              value={v.pillarId}
              onChange={(e) => set({ pillarId: e.target.value })}
            >
              {options.pillars.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <FrequencyField value={v.frequency} onChange={(frequency) => set({ frequency })} />
        <Field label={t("template")}>
          {(fid) => (
            <select
              id={fid}
              className={controlClass}
              value={v.templateKey ?? ""}
              onChange={(e) => set({ templateKey: e.target.value || null })}
            >
              <option value="">{t("templateNone")}</option>
              {options.templates.map((tpl) => (
                <option key={tpl.key} value={tpl.key}>
                  {tpl.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        {text("hookFormula", t("hookFormula"))}
        {text("hookExample", t("hookExample"))}
        {text("cta", t("cta"))}
      </div>
      <Checks
        legend={t("channels")}
        options={channelOptions}
        value={v.channels ?? []}
        onChange={(channels) => set({ channels: channels as ContentChannel[] })}
      />
      <Checks
        legend={t("products")}
        options={options.products.map((p) => ({ value: p.id, label: p.name }))}
        value={v.productIds ?? []}
        onChange={(productIds) => set({ productIds })}
      />
      <FormError error={error} />
      <Actions pending={pending} onCancel={onClose} />
    </form>
  );
}
