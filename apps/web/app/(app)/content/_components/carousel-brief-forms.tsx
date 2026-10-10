"use client";

import {
  BRIEF_MIN_CHARS,
  contentLanguages,
  type Brief,
  type CarouselParamsInput,
  type ContentChannel,
} from "@forgecy/content/client";
import { contentObjectives } from "@forgecy/core";
import { Badge, Button, Input, Label } from "@forgecy/ui";
import { useRouter } from "next/navigation";
import type { ToneAxisKey } from "@forgecy/brand";
import { useTranslations } from "next-intl";
import { useState, useTransition, type ReactNode } from "react";
import { saveBriefAction, updateParamsAction } from "../actions";
import { controlClass } from "./action-button";
import type { NewCarouselOptions } from "./carousel-new-form";

type Objective = CarouselParamsInput["objective"];
type Language = NonNullable<CarouselParamsInput["language"]>;
type PlanField = Brief["fromPlan"][number];

export interface ToneAxisOption {
  key: string;
  left: string;
  right: string;
}

interface Props {
  slug: string;
  clientId: string;
  contentId: string;
  briefRev: number;
  editable: boolean;
  hasSlides: boolean;
  params: CarouselParamsInput & { format: string };
  brief: Brief;
  options: NewCarouselOptions;
  toneAxes: ToneAxisOption[];
  productPrice: string | null;
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-body-sm text-fg-muted">{hint}</p> : null}
    </div>
  );
}

function Status({ error, saved }: { error: string | null; saved: boolean }) {
  const t = useTranslations("content.brief");
  if (error)
    return (
      <span role="alert" className="text-body-sm text-error">
        {error}
      </span>
    );
  return saved ? (
    <span role="status" className="text-body-sm text-fg-muted">
      {t("saved")}
    </span>
  ) : null;
}

/** Brief tab: carousel parameters and the structured brief (they share `briefRev`). */
export function CarouselBriefForms(props: Props) {
  const router = useRouter();
  const [rev, setRev] = useState(props.briefRev);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <ParamsForm
        {...props}
        rev={rev}
        setRev={setRev}
        pending={pending}
        start={start}
        router={router}
      />
      <BriefForm
        {...props}
        rev={rev}
        setRev={setRev}
        pending={pending}
        start={start}
        router={router}
      />
    </div>
  );
}

interface Inner extends Props {
  rev: number;
  setRev: (n: number) => void;
  pending: boolean;
  start: (fn: () => Promise<void>) => void;
  router: ReturnType<typeof useRouter>;
}

function ParamsForm({
  slug,
  clientId,
  contentId,
  editable,
  hasSlides,
  params,
  options,
  rev,
  setRev,
  pending,
  start,
  router,
}: Inner) {
  const templates = options.templates;
  const t = useTranslations("content.brief.params");
  const tl = useTranslations("content.labels");
  const [title, setTitle] = useState(params.title ?? "");
  const [templateKey, setTemplateKey] = useState(params.templateKey);
  const template = templates.find((x) => x.key === templateKey);
  const [slideCount, setSlideCount] = useState(params.slideCount);
  const [objective, setObjective] = useState<Objective>(params.objective);
  const [audienceIds, setAudienceIds] = useState<string[]>(params.audienceIds);
  const [pillarId, setPillarId] = useState(params.pillarId ?? "");
  const [rubricId, setRubricId] = useState(params.rubricId ?? "");
  const [productId, setProductId] = useState(params.productId ?? "");
  const [language, setLanguage] = useState<Language>(params.language ?? "en");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const rubrics = options.rubrics.filter((r) => !pillarId || r.pillarId === pillarId);

  function save(e: React.FormEvent) {
    e.preventDefault();
    const format = template?.format ?? params.format;
    const changed = templateKey !== params.templateKey || format !== params.format;
    if (changed && hasSlides && !window.confirm(t("resetSlidesConfirm"))) return;
    setError(null);
    setSaved(false);
    start(async () => {
      const call = (resetSlides: boolean) =>
        updateParamsAction({
          slug,
          clientId,
          id: contentId,
          briefRev: rev,
          resetSlides,
          params: {
            title,
            objective,
            audienceIds,
            pillarId: pillarId || null,
            rubricId: rubricId || null,
            productId: productId || null,
            channel: (template?.channel ?? params.channel) as ContentChannel,
            format: format as CarouselParamsInput["format"],
            templateKey,
            slideCount,
            language,
            planItemId: params.planItemId ?? null,
          },
        });
      let r = await call(changed && hasSlides);
      if (
        !r.ok &&
        r.code === "TEMPLATE-CHANGE-RESETS" &&
        window.confirm(t("continueConfirm", { error: r.error }))
      )
        r = await call(true);
      if (!r.ok) return setError(r.error);
      setRev(r.briefRev);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={save}
      className="grid content-start gap-4 rounded-lg border border-subtle bg-surface p-5"
    >
      <h3 className="text-heading-sm text-fg">{t("title")}</h3>
      <fieldset disabled={!editable || pending} className="grid gap-4">
        <Field id="cp-title" label={t("titleField")}>
          <Input
            id="cp-title"
            value={title}
            maxLength={160}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            id="cp-template"
            label={t("template")}
            hint={hasSlides ? t("templateHint") : undefined}
          >
            <select
              id="cp-template"
              className={controlClass}
              value={templateKey}
              onChange={(e) => {
                setTemplateKey(e.target.value);
                const tpl = templates.find((x) => x.key === e.target.value);
                if (tpl)
                  setSlideCount(Math.min(Math.max(slideCount, tpl.slides.min), tpl.slides.max));
              }}
            >
              {template ? null : (
                <option value={params.templateKey}>
                  {t("templateUnavailable", { key: params.templateKey })}
                </option>
              )}
              {templates.map((tpl) => (
                <option key={tpl.key} value={tpl.key}>
                  {tl("templateChannel", { name: tpl.name, channel: tpl.channel })}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id="cp-slides"
            label={t("slides")}
            hint={
              template
                ? t("slidesRange", { min: template.slides.min, max: template.slides.max })
                : undefined
            }
          >
            <Input
              id="cp-slides"
              type="number"
              min={template?.slides.min ?? 1}
              max={template?.slides.max ?? 20}
              value={slideCount}
              onChange={(e) => setSlideCount(Number(e.target.value))}
            />
          </Field>
          <Field id="cp-objective" label={t("objective")}>
            <select
              id="cp-objective"
              className={controlClass}
              value={objective}
              onChange={(e) => setObjective(e.target.value as Objective)}
            >
              {contentObjectives.map((o) => (
                <option key={o} value={o}>
                  {tl(`objective.${o}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="cp-language" label={t("language")}>
            <select
              id="cp-language"
              className={controlClass}
              value={language}
              onChange={(e) => setLanguage(e.target.value as Language)}
            >
              {contentLanguages.map((l) => (
                <option key={l.code} value={l.code}>
                  {tl(`language.${l.code}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="cp-pillar" label={t("pillar")}>
            <select
              id="cp-pillar"
              className={controlClass}
              value={pillarId}
              onChange={(e) => {
                setPillarId(e.target.value);
                setRubricId("");
              }}
            >
              <option value="">{t("none")}</option>
              {options.pillars.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="cp-rubric" label={t("rubric")}>
            <select
              id="cp-rubric"
              className={controlClass}
              value={rubricId}
              onChange={(e) => setRubricId(e.target.value)}
            >
              <option value="">{t("none")}</option>
              {rubrics.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="cp-product" label={t("product")}>
            <select
              id="cp-product"
              className={controlClass}
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">{t("noProduct")}</option>
              {productId && !options.products.some((p) => p.id === productId) ? (
                <option value={productId}>{t("productNotApproved")}</option>
              ) : null}
              {options.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-label text-fg">{t("audience")}</legend>
          <div className="flex flex-wrap gap-4">
            {options.audience.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-body-sm text-fg">
                <input
                  type="checkbox"
                  checked={audienceIds.includes(a.id)}
                  onChange={(e) =>
                    setAudienceIds((cur) =>
                      e.target.checked ? [...cur, a.id] : cur.filter((x) => x !== a.id),
                    )
                  }
                />
                {a.name}
              </label>
            ))}
          </div>
        </fieldset>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!editable || pending || !audienceIds.length}>
          {t("save")}
        </Button>
        <Status error={error} saved={saved} />
      </div>
    </form>
  );
}

function BriefForm({
  slug,
  clientId,
  contentId,
  editable,
  brief,
  toneAxes,
  productPrice,
  rev,
  setRev,
  pending,
  start,
  router,
}: Inner) {
  const [b, setB] = useState<Brief>(brief);
  const [constraints, setConstraints] = useState(brief.constraints.join("\n"));
  const t = useTranslations("content.brief.form");
  const ta = useTranslations("deliverable.brandBook.axes");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof Brief>(key: K, value: Brief[K]) =>
    setB((cur) => ({
      ...cur,
      [key]: value,
      fromPlan: cur.fromPlan.filter((f) => f !== key),
    }));
  const fromPlan = (f: PlanField) =>
    b.fromPlan.includes(f) ? <Badge variant="info">{t("fromPlan")}</Badge> : null;
  const toneOf = (axis: string) => b.toneShift.find((x) => x.axis === axis)?.delta ?? 0;
  const setTone = (axis: string, delta: -1 | 0 | 1) =>
    set("toneShift", [
      ...b.toneShift.filter((x) => x.axis !== axis),
      ...(delta ? [{ axis, delta }] : []),
    ]);
  const textLen = b.text.trim().length;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const list = constraints
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    start(async () => {
      const r = await saveBriefAction({
        slug,
        clientId,
        id: contentId,
        briefRev: rev,
        brief: {
          ...b,
          constraints: list,
          usePrice: productPrice ? b.usePrice : false,
          fromPlan:
            list.join("\n") === brief.constraints.join("\n")
              ? b.fromPlan
              : b.fromPlan.filter((f) => f !== "constraints"),
        },
      });
      if (!r.ok) return setError(r.error);
      setRev(r.briefRev);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={save}
      className="grid content-start gap-4 rounded-lg border border-subtle bg-surface p-5"
    >
      <h3 className="text-heading-sm text-fg">{t("title")}</h3>
      <fieldset disabled={!editable || pending} className="grid gap-4">
        <Field
          id="cb-text"
          label={
            <span className="flex items-center gap-2">
              {t("text")} {fromPlan("text")}
            </span>
          }
          hint={
            textLen < BRIEF_MIN_CHARS
              ? t("textHint", { min: BRIEF_MIN_CHARS, count: textLen })
              : undefined
          }
        >
          <textarea
            id="cb-text"
            rows={5}
            maxLength={2000}
            className={controlClass}
            value={b.text}
            onChange={(e) => set("text", e.target.value)}
          />
        </Field>
        <Field
          id="cb-problem"
          label={
            <span className="flex items-center gap-2">
              {t("problem")} {fromPlan("problem")}
            </span>
          }
        >
          <textarea
            id="cb-problem"
            rows={2}
            maxLength={300}
            className={controlClass}
            value={b.problem}
            onChange={(e) => set("problem", e.target.value)}
          />
        </Field>
        <Field id="cb-audience" label={t("audienceNote")}>
          <textarea
            id="cb-audience"
            rows={2}
            maxLength={300}
            className={controlClass}
            value={b.audienceNote}
            onChange={(e) => set("audienceNote", e.target.value)}
          />
        </Field>
        <Field
          id="cb-promise"
          label={
            <span className="flex items-center gap-2">
              {t("promise")} {fromPlan("promise")}
            </span>
          }
        >
          <Input
            id="cb-promise"
            maxLength={200}
            value={b.promise}
            onChange={(e) => set("promise", e.target.value)}
          />
        </Field>
        <Field
          id="cb-cta"
          label={
            <span className="flex items-center gap-2">
              {t("cta")} {fromPlan("cta")}
            </span>
          }
        >
          <Input
            id="cb-cta"
            maxLength={200}
            value={b.cta}
            onChange={(e) => set("cta", e.target.value)}
          />
        </Field>
        <Field
          id="cb-constraints"
          label={
            <span className="flex items-center gap-2">
              {t("constraints")} {fromPlan("constraints")}
            </span>
          }
          hint={t("constraintsHint")}
        >
          <textarea
            id="cb-constraints"
            rows={3}
            className={controlClass}
            value={constraints}
            onChange={(e) => setConstraints(e.target.value)}
          />
        </Field>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-label text-fg">{t("tone")}</legend>
          <p className="text-body-sm text-fg-muted">{t("toneHint")}</p>
          {toneAxes.map((a) => (
            <div key={a.key} className="flex flex-wrap items-center gap-3 text-body-sm text-fg">
              <span className="min-w-48">
                {ta(`${a.key as ToneAxisKey}.left`)} · {ta(`${a.key as ToneAxisKey}.right`)}
              </span>
              {([-1, 0, 1] as const).map((d) => (
                <label key={d} className="flex items-center gap-1">
                  <input
                    type="radio"
                    name={`tone-${a.key}`}
                    checked={toneOf(a.key) === d}
                    onChange={() => setTone(a.key, d)}
                  />
                  {d === -1
                    ? t("toneMore", { quality: ta(`${a.key as ToneAxisKey}.left`).toLowerCase() })
                    : d === 1
                      ? t("toneMore", {
                          quality: ta(`${a.key as ToneAxisKey}.right`).toLowerCase(),
                        })
                      : t("toneSame")}
                </label>
              ))}
            </div>
          ))}
        </fieldset>
        {productPrice ? (
          <label className="flex items-center gap-2 text-body-sm text-fg">
            <input
              type="checkbox"
              checked={b.usePrice}
              onChange={(e) => set("usePrice", e.target.checked)}
            />
            {t("usePrice", { price: productPrice })}
          </label>
        ) : null}
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-label text-fg">{t("outputs")}</legend>
          <label className="flex items-center gap-2 text-body-sm text-fg">
            <input
              type="checkbox"
              checked={b.outputs.caption}
              onChange={(e) => set("outputs", { ...b.outputs, caption: e.target.checked })}
            />
            {t("caption")}
          </label>
          <label className="flex items-center gap-2 text-body-sm text-fg">
            <input
              type="checkbox"
              checked={b.outputs.altText}
              onChange={(e) => set("outputs", { ...b.outputs, altText: e.target.checked })}
            />
            {t("altText")}
          </label>
          <label className="flex items-center gap-2 text-body-sm text-fg">
            <input
              type="checkbox"
              checked={b.outputs.designerNotes}
              onChange={(e) => set("outputs", { ...b.outputs, designerNotes: e.target.checked })}
            />
            {t("designerNotes")}
          </label>
          <label className="flex items-center gap-2 text-body-sm text-fg">
            {t("hashtags")}
            <Input
              type="number"
              min={0}
              max={10}
              className="w-20"
              value={b.outputs.hashtags}
              onChange={(e) =>
                set("outputs", {
                  ...b.outputs,
                  hashtags: Math.max(0, Math.min(10, Number(e.target.value) || 0)),
                })
              }
            />
          </label>
        </fieldset>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!editable || pending}>
          {t("save")}
        </Button>
        <Status error={error} saved={saved} />
      </div>
    </form>
  );
}
