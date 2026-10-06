"use client";

import {
  channelLabels,
  contentLanguages,
  type CarouselParamsInput,
  type ContentChannel,
} from "@forgecy/content/client";
import type { getNewCarouselOptions } from "@forgecy/content";
import { contentObjectives } from "@forgecy/core";
import { Button, Input, Label } from "@forgecy/ui";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { createCarouselAction } from "../actions";
import { carouselPath } from "../_lib/paths";
import { controlClass } from "./action-button";

export type NewCarouselOptions = Awaited<ReturnType<typeof getNewCarouselOptions>>;
type Objective = CarouselParamsInput["objective"];
type Language = NonNullable<CarouselParamsInput["language"]>;

export interface PlanSeed {
  id: string;
  title: string;
  channel: ContentChannel;
  format: string;
  pillarId: string | null;
  rubricId: string | null;
  productId: string | null;
  briefText: string;
}

/** “New carousel”: parameters and the first lines of the brief. */
export function CarouselNewForm({
  slug,
  clientId,
  options,
  plan,
}: {
  slug: string;
  clientId: string;
  options: NewCarouselOptions;
  plan: PlanSeed | null;
}) {
  const router = useRouter();
  const t = useTranslations("content.newCarousel.form");
  const tl = useTranslations("content.labels");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const templates = options.templates.filter((t) => t.channel in channelLabels);
  const channels = [...new Set(templates.map((t) => t.channel as ContentChannel))];
  const firstTemplate = (ch: string, format?: string) =>
    templates.find((t) => t.channel === ch && (!format || t.format === format)) ??
    templates.find((t) => t.channel === ch);

  const [title, setTitle] = useState(plan?.title ?? "");
  const [channel, setChannel] = useState<string>(plan?.channel ?? channels[0] ?? "instagram");
  const [templateKey, setTemplateKey] = useState(
    firstTemplate(plan?.channel ?? channels[0] ?? "", plan?.format)?.key ?? "",
  );
  const template = templates.find((t) => t.key === templateKey);
  const [slideCount, setSlideCount] = useState(template?.slides.default ?? 7);
  const [objective, setObjective] = useState<Objective>("awareness");
  const [audienceIds, setAudienceIds] = useState<string[]>(
    options.audience.length === 1 ? [options.audience[0]!.id] : [],
  );
  const [pillarId, setPillarId] = useState(plan?.pillarId ?? "");
  const [rubricId, setRubricId] = useState(plan?.rubricId ?? "");
  const [productId, setProductId] = useState(plan?.productId ?? "");
  const [language, setLanguage] = useState<Language>("en");
  const [briefText, setBriefText] = useState(plan?.briefText ?? "");

  const rubrics = options.rubrics.filter((r) => !pillarId || r.pillarId === pillarId);
  // Every carousel speaks to at least one audience segment of the published Brand Identity.
  const disabled =
    !options.brandPublished || templates.length === 0 || options.audience.length === 0;

  function pickTemplate(key: string) {
    setTemplateKey(key);
    const tpl = templates.find((x) => x.key === key);
    if (tpl) setSlideCount(tpl.slides.default);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!template) return setError(t("chooseTemplate"));
    if (!audienceIds.length) return setError(t("chooseAudience"));
    setError(null);
    start(async () => {
      const r = await createCarouselAction({
        slug,
        clientId,
        params: {
          title,
          objective,
          audienceIds,
          pillarId: pillarId || null,
          rubricId: rubricId || null,
          productId: productId || null,
          channel: channel as ContentChannel,
          format: template.format as CarouselParamsInput["format"],
          templateKey: template.key,
          slideCount,
          language,
          planItemId: plan?.id ?? null,
        },
        // Untouched plan text goes empty: the server copies it and marks it as coming from the plan.
        brief: { text: plan && briefText === plan.briefText ? "" : briefText },
      });
      if (!r.ok) setError(r.error);
      else router.push(carouselPath(slug, r.id) as never);
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-5">
      <fieldset disabled={disabled || pending} className="grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor="nc-title">{t("title")}</Label>
          <Input
            id="nc-title"
            value={title}
            maxLength={160}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("titlePlaceholder")}
          />
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="nc-channel">{t("channel")}</Label>
            <select
              id="nc-channel"
              className={controlClass}
              value={channel}
              onChange={(e) => {
                setChannel(e.target.value);
                const tpl = firstTemplate(e.target.value);
                if (tpl) pickTemplate(tpl.key);
              }}
            >
              {channels.map((c) => (
                <option key={c} value={c}>
                  {channelLabels[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="nc-template">{t("template")}</Label>
            <select
              id="nc-template"
              className={controlClass}
              value={templateKey}
              onChange={(e) => pickTemplate(e.target.value)}
            >
              {templates
                .filter((tpl) => tpl.channel === channel)
                .map((tpl) => (
                  <option key={tpl.key} value={tpl.key}>
                    {tl("templateVersion", { name: tpl.name, version: tpl.version })}
                  </option>
                ))}
            </select>
            {template?.description ? (
              <p className="text-body-sm text-fg-muted">{template.description}</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="nc-slides">{t("slides")}</Label>
            <Input
              id="nc-slides"
              type="number"
              min={template?.slides.min ?? 1}
              max={template?.slides.max ?? 20}
              value={slideCount}
              onChange={(e) => setSlideCount(Number(e.target.value))}
            />
            {template ? (
              <p className="text-body-sm text-fg-muted">
                {t("slidesRange", { min: template.slides.min, max: template.slides.max })}
              </p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="nc-objective">{t("objective")}</Label>
            <select
              id="nc-objective"
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
          </div>
          <div className="grid gap-2">
            <Label htmlFor="nc-pillar">{t("pillar")}</Label>
            <select
              id="nc-pillar"
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
          </div>
          <div className="grid gap-2">
            <Label htmlFor="nc-rubric">{t("rubric")}</Label>
            <select
              id="nc-rubric"
              className={controlClass}
              value={rubricId}
              onChange={(e) => {
                setRubricId(e.target.value);
                const r = options.rubrics.find((x) => x.id === e.target.value);
                if (r && !pillarId) setPillarId(r.pillarId);
                const tpl = r?.templateKey && templates.find((x) => x.key === r.templateKey);
                if (tpl) {
                  setChannel(tpl.channel);
                  pickTemplate(tpl.key);
                }
              }}
            >
              <option value="">{t("none")}</option>
              {rubrics.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="nc-product">{t("product")}</Label>
            <select
              id="nc-product"
              className={controlClass}
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">{t("noProduct")}</option>
              {options.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.price ? ` · ${p.price}` : ""}
                </option>
              ))}
            </select>
            {options.products.length === 0 ? (
              <p className="text-body-sm text-fg-muted">{t("noProducts")}</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="nc-language">{t("language")}</Label>
            <select
              id="nc-language"
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
          </div>
        </div>
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-label text-fg">{t("audience")}</legend>
          {options.audience.length === 0 ? (
            <p className="text-body-sm text-fg-muted">
              {t.rich("noAudience", {
                link: (chunks) => (
                  <Link href={`/brand/${slug}/strategy` as Route} className="text-link underline">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          ) : (
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
          )}
        </fieldset>
        <div className="grid gap-2">
          <Label htmlFor="nc-brief">{t("brief")}</Label>
          <textarea
            id="nc-brief"
            rows={5}
            maxLength={2000}
            className={controlClass}
            value={briefText}
            onChange={(e) => setBriefText(e.target.value)}
            placeholder={t("briefPlaceholder")}
          />
          {plan && briefText === plan.briefText ? (
            <p className="text-body-sm text-fg-muted">{t("fromPlan")}</p>
          ) : null}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={disabled || pending}>
          {pending ? t("creating") : t("submit")}
        </Button>
        {error ? (
          <span role="alert" className="text-body-sm text-error">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
