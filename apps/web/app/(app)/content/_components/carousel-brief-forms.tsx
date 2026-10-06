"use client";

import {
  BRIEF_MIN_CHARS,
  contentLanguages,
  objectiveLabels,
  type Brief,
  type CarouselParamsInput,
  type ContentChannel,
} from "@forgecy/content/client";
import { Badge, Button, Input, Label } from "@forgecy/ui";
import { useRouter } from "next/navigation";
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
  if (error)
    return (
      <span role="alert" className="text-body-sm text-error">
        {error}
      </span>
    );
  return saved ? (
    <span role="status" className="text-body-sm text-fg-muted">
      Saved
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
  const [title, setTitle] = useState(params.title ?? "");
  const [templateKey, setTemplateKey] = useState(params.templateKey);
  const template = templates.find((t) => t.key === templateKey);
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
    if (
      changed &&
      hasSlides &&
      !window.confirm(
        "Changing the template or format recreates the slides: the current slide copy is lost (it stays in the saved versions). Continue?",
      )
    )
      return;
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
      if (!r.ok && r.code === "TEMPLATE-CHANGE-RESETS" && window.confirm(`${r.error}. Continue?`))
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
      <h3 className="text-heading-sm text-fg">Parameters</h3>
      <fieldset disabled={!editable || pending} className="grid gap-4">
        <Field id="cp-title" label="Title">
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
            label="Format and template"
            hint={hasSlides ? "Changing it recreates the slides." : undefined}
          >
            <select
              id="cp-template"
              className={controlClass}
              value={templateKey}
              onChange={(e) => {
                setTemplateKey(e.target.value);
                const t = templates.find((x) => x.key === e.target.value);
                if (t) setSlideCount(Math.min(Math.max(slideCount, t.slides.min), t.slides.max));
              }}
            >
              {template ? null : (
                <option value={params.templateKey}>{params.templateKey} (unavailable)</option>
              )}
              {templates.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name} · {t.channel === "linkedin" ? "LinkedIn" : "Instagram"}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id="cp-slides"
            label="Number of slides"
            hint={template ? `From ${template.slides.min} to ${template.slides.max}` : undefined}
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
          <Field id="cp-objective" label="Goal">
            <select
              id="cp-objective"
              className={controlClass}
              value={objective}
              onChange={(e) => setObjective(e.target.value as Objective)}
            >
              {(Object.keys(objectiveLabels) as Objective[]).map((o) => (
                <option key={o} value={o}>
                  {objectiveLabels[o]}
                </option>
              ))}
            </select>
          </Field>
          <Field id="cp-language" label="Language">
            <select
              id="cp-language"
              className={controlClass}
              value={language}
              onChange={(e) => setLanguage(e.target.value as Language)}
            >
              {contentLanguages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="cp-pillar" label="Pillar">
            <select
              id="cp-pillar"
              className={controlClass}
              value={pillarId}
              onChange={(e) => {
                setPillarId(e.target.value);
                setRubricId("");
              }}
            >
              <option value="">None</option>
              {options.pillars.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="cp-rubric" label="Rubric">
            <select
              id="cp-rubric"
              className={controlClass}
              value={rubricId}
              onChange={(e) => setRubricId(e.target.value)}
            >
              <option value="">None</option>
              {rubrics.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="cp-product" label="Product (optional)">
            <select
              id="cp-product"
              className={controlClass}
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">No product</option>
              {productId && !options.products.some((p) => p.id === productId) ? (
                <option value={productId}>Product no longer approved</option>
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
          <legend className="mb-2 text-label text-fg">Audience</legend>
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
          Save parameters
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
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof Brief>(key: K, value: Brief[K]) =>
    setB((cur) => ({
      ...cur,
      [key]: value,
      fromPlan: cur.fromPlan.filter((f) => f !== key),
    }));
  const fromPlan = (f: PlanField) =>
    b.fromPlan.includes(f) ? <Badge variant="info">From the plan</Badge> : null;
  const toneOf = (axis: string) => b.toneShift.find((t) => t.axis === axis)?.delta ?? 0;
  const setTone = (axis: string, delta: -1 | 0 | 1) =>
    set("toneShift", [
      ...b.toneShift.filter((t) => t.axis !== axis),
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
      <h3 className="text-heading-sm text-fg">Brief</h3>
      <fieldset disabled={!editable || pending} className="grid gap-4">
        <Field
          id="cb-text"
          label={
            <span className="flex items-center gap-2">What it’s about {fromPlan("text")}</span>
          }
          hint={
            textLen < BRIEF_MIN_CHARS
              ? `At least ${BRIEF_MIN_CHARS} characters to generate the outline (now ${textLen}).`
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
            <span className="flex items-center gap-2">Audience problem {fromPlan("problem")}</span>
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
        <Field id="cb-audience" label="Audience note">
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
          label={<span className="flex items-center gap-2">Key message {fromPlan("promise")}</span>}
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
          label={<span className="flex items-center gap-2">Call to action {fromPlan("cta")}</span>}
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
            <span className="flex items-center gap-2">Constraints {fromPlan("constraints")}</span>
          }
          hint="One per line (up to 20)."
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
          <legend className="mb-1 text-label text-fg">Tone shift</legend>
          <p className="text-body-sm text-fg-muted">
            At most one step away from the Brand Identity.
          </p>
          {toneAxes.map((a) => (
            <div key={a.key} className="flex flex-wrap items-center gap-3 text-body-sm text-fg">
              <span className="min-w-48">
                {a.left} · {a.right}
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
                    ? `More ${a.left.toLowerCase()}`
                    : d === 1
                      ? `More ${a.right.toLowerCase()}`
                      : "As in the Brand Identity"}
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
            Mention the product price ({productPrice})
          </label>
        ) : null}
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-label text-fg">To prepare</legend>
          <label className="flex items-center gap-2 text-body-sm text-fg">
            <input
              type="checkbox"
              checked={b.outputs.caption}
              onChange={(e) => set("outputs", { ...b.outputs, caption: e.target.checked })}
            />
            Caption
          </label>
          <label className="flex items-center gap-2 text-body-sm text-fg">
            <input
              type="checkbox"
              checked={b.outputs.altText}
              onChange={(e) => set("outputs", { ...b.outputs, altText: e.target.checked })}
            />
            Image alt text
          </label>
          <label className="flex items-center gap-2 text-body-sm text-fg">
            <input
              type="checkbox"
              checked={b.outputs.designerNotes}
              onChange={(e) => set("outputs", { ...b.outputs, designerNotes: e.target.checked })}
            />
            Notes for the designer
          </label>
          <label className="flex items-center gap-2 text-body-sm text-fg">
            Hashtags
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
          Save brief
        </Button>
        <Status error={error} saved={saved} />
      </div>
    </form>
  );
}
