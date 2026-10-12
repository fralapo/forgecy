"use client";

import {
  configBlockers,
  itemIssues,
  type AutomationItem,
  type AutomationParams,
} from "@forgecy/automations/client";
import { BRIEF_MIN_CHARS, contentLanguages, offeredFormats } from "@forgecy/content/client";
import {
  AUTOMATION_MAX_ITEMS,
  contentObjectives,
  type AutomationSource,
  type AutomationStopPoint,
} from "@forgecy/core";
import { Button, Card, Input, Label } from "@forgecy/ui";
import { CircleAlert, Play, Plus, Save, Trash2 } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { useFormat } from "@/lib/use-format";
import { controlClass } from "../../content/_components/action-button";
import { saveAutomationAction, startAutomationAction } from "../actions";

export interface EditorPlanItem {
  id: string;
  day: number;
  channel: string;
  format: string | null;
  pillarId: string | null;
  rubricId: string | null;
  theme: string;
  hook: string;
  notes: string;
  hasCarousel: boolean;
}

export interface EditorSummary {
  policy: string;
  policyBlocker: "noAi" | "localOnlyNoModel" | null;
  /** Average cost of one outline and of one set of slides, in micro-dollars. */
  costMicroUsd: { outline: number; slides: number };
  budgets: { scope: "client" | "agency"; limitMicroUsd: number; leftMicroUsd: number }[];
  clientName: string;
  /** The published Brand Identity has at least one live audience. */
  hasAudience: boolean;
}

const newId = () => crypto.randomUUID().slice(0, 12);
const usd = (micro: number) => micro / 1_000_000;

/** Configuration tab of page 59: items, common parameters, stop point, start summary. */
export function AutomationEditor({
  id,
  rev: initialRev,
  name: initialName,
  source,
  stopAt: initialStopAt,
  params: initialParams,
  items: initialItems,
  readOnly,
  canStart,
  options,
  plan,
  planPath,
  summary,
}: {
  id: string;
  rev: number;
  name: string;
  source: AutomationSource;
  stopAt: AutomationStopPoint;
  params: AutomationParams;
  items: AutomationItem[];
  readOnly: boolean;
  canStart: boolean;
  options: {
    templates: { key: string; name: string; format: string }[];
    pillars: { id: string; name: string }[];
    rubrics: { id: string; name: string; pillarId: string }[];
  };
  plan: EditorPlanItem[];
  planPath: string;
  summary: EditorSummary;
}) {
  const t = useTranslations("automations.detail");
  const ta = useTranslations("automations");
  const tl = useTranslations("content.labels");
  const tf = useTranslations("templates.format");
  const format = useFormat();
  const router = useRouter();
  const [rev, setRev] = useState(initialRev);
  const [name, setName] = useState(initialName);
  const [stopAt, setStopAt] = useState(initialStopAt);
  const [params, setParams] = useState(initialParams);
  const [items, setItems] = useState(initialItems);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [confirmCost, setConfirmCost] = useState(false);
  const [pending, start] = useTransition();

  const touch = () => {
    setDirty(true);
    setSaved(false);
  };
  const setItem = (i: number, patch: Partial<AutomationItem>) => {
    setItems((all) => all.map((it, n) => (n === i ? { ...it, ...patch } : it)));
    touch();
  };
  const blank = (over: Partial<AutomationItem> = {}): AutomationItem => ({
    id: newId(),
    title: "",
    brief: "",
    objective: null,
    pillarId: null,
    rubricId: null,
    audienceNote: "",
    cta: "",
    planItemId: null,
    format: null,
    channel: null,
    ...over,
  });
  const room = AUTOMATION_MAX_ITEMS - items.length;

  const formats = offeredFormats(options.templates.map((x) => x.format));
  const templatesOfFormat = options.templates.filter((x) => x.format === params.format);
  const money = (micro: number) => format.currency(usd(micro), "USD");

  // Estimate on the items as they are now; the server checks again on start.
  const estimate = useMemo(() => {
    const per =
      summary.costMicroUsd.outline + (stopAt === "slides" ? summary.costMicroUsd.slides : 0);
    const total = per * items.length;
    const left = summary.budgets.length
      ? Math.min(...summary.budgets.map((b) => b.leftMicroUsd))
      : null;
    return {
      low: Math.round(total * 0.6),
      high: Math.round(total * 1.4),
      exhausted: left !== null && left <= 0,
      needsConfirmation: left !== null && total > left * 0.9,
      fits: left !== null && total > left && per > 0 ? Math.floor(left / per) : null,
    };
  }, [items.length, stopAt, summary]);

  const blockers = [
    ...configBlockers(items),
    ...(summary.policyBlocker ? [summary.policyBlocker] : []),
    ...(summary.hasAudience ? [] : (["noAudience"] as const)),
    ...(estimate.exhausted ? (["exhausted"] as const) : []),
    ...(dirty ? (["unsaved"] as const) : []),
  ];
  const valid = items.filter((i) => itemIssues(i).length === 0).length;

  function save() {
    setError(null);
    start(async () => {
      const r = await saveAutomationAction({ id, rev, name, stopAt, params, items });
      if (!r.ok) return setError(r.error);
      setRev(r.rev);
      setDirty(false);
      setSaved(true);
      router.refresh();
    });
  }

  function launch() {
    setError(null);
    start(async () => {
      const r = await startAutomationAction({ id, confirmCost });
      if (!r.ok) return setError(r.error);
      setConfirming(false);
      router.push(`/automations/${id}?tab=runs&run=${r.runId}` as Route);
    });
  }

  function addPasted() {
    const lines = paste
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, Math.max(0, room));
    if (!lines.length) return;
    setItems((all) => [...all, ...lines.map((brief) => blank({ brief: brief.slice(0, 2000) }))]);
    setPaste("");
    touch();
  }

  const usedPlanItems = new Set(items.map((i) => i.planItemId).filter(Boolean));
  const freePlan = plan.filter((p) => !p.hasCarousel && !usedPlanItems.has(p.id));

  function addPlanItems() {
    const chosen = freePlan.filter((p) => picked.includes(p.id)).slice(0, Math.max(0, room));
    setItems((all) => [
      ...all,
      ...chosen.map((p) =>
        blank({
          title: p.theme.slice(0, 160),
          brief: [p.theme, p.hook, p.notes].filter(Boolean).join("\n").slice(0, 2000),
          pillarId: p.pillarId,
          rubricId: p.rubricId,
          planItemId: p.id,
          channel: (p.channel as AutomationItem["channel"]) ?? null,
          format: (p.format as AutomationItem["format"]) ?? null,
        }),
      ),
    ]);
    setPicked([]);
    touch();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-12">
      <div className="grid content-start gap-6 xl:col-span-8">
        <fieldset disabled={readOnly || pending} className="grid gap-6">
          <Card className="grid gap-2 p-5">
            <Label htmlFor="au-name">{t("name")}</Label>
            <Input
              id="au-name"
              value={name}
              maxLength={120}
              onChange={(e) => {
                setName(e.target.value);
                touch();
              }}
            />
          </Card>

          {source === "plan" ? (
            <Card className="grid gap-3 p-5">
              <h2 className="text-heading-sm text-fg">{t("plan.heading")}</h2>
              <p className="text-body-sm text-fg-muted">{t("plan.help")}</p>
              {freePlan.length === 0 ? (
                <p className="text-body-sm text-fg-muted">
                  {t.rich("plan.empty", {
                    link: (c) => <Link href={planPath as Route}>{c}</Link>,
                  })}
                </p>
              ) : (
                <>
                  <ul className="grid gap-2">
                    {plan.map((p) => {
                      const used = usedPlanItems.has(p.id);
                      return (
                        <li key={p.id}>
                          <label className="flex items-start gap-2 text-body-sm text-fg">
                            <input
                              type="checkbox"
                              disabled={p.hasCarousel || used}
                              checked={used || picked.includes(p.id)}
                              onChange={(e) =>
                                setPicked((all) =>
                                  e.target.checked ? [...all, p.id] : all.filter((x) => x !== p.id),
                                )
                              }
                            />
                            <span>
                              <span className="font-medium">{t("plan.day", { day: p.day })}</span>
                              {" · "}
                              {p.theme}
                              {p.hasCarousel ? (
                                <span className="text-fg-muted"> · {t("plan.hasCarousel")}</span>
                              ) : null}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="w-fit"
                    disabled={!picked.length || room <= 0}
                    onClick={addPlanItems}
                  >
                    <Plus aria-hidden className="size-4" />
                    {t("plan.add")}
                  </Button>
                </>
              )}
            </Card>
          ) : null}

          <Card className="grid gap-4 p-5">
            <div>
              <h2 className="text-heading-sm text-fg">{t("items.heading")}</h2>
              <p className="text-body-sm text-fg-muted">
                {t("items.briefsHelp", { min: BRIEF_MIN_CHARS })}
              </p>
            </div>
            {items.length === 0 ? (
              <p className="text-body-sm text-fg-muted">{t("items.empty")}</p>
            ) : null}
            <ol className="grid gap-4">
              {items.map((it, i) => {
                const issues = itemIssues(it);
                const rubrics = options.rubrics.filter(
                  (r) => !it.pillarId || r.pillarId === it.pillarId,
                );
                const p = `au-item-${it.id}`;
                return (
                  <li key={it.id} className="grid gap-3 rounded-md border border-subtle p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-label text-fg">{t("items.item", { n: i + 1 })}</h3>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setItems((all) => all.filter((_, n) => n !== i));
                          touch();
                        }}
                      >
                        <Trash2 aria-hidden className="size-4" />
                        {t("items.remove")}
                      </Button>
                    </div>
                    {issues.length ? (
                      <p className="flex items-center gap-2 text-body-sm text-warning">
                        <CircleAlert aria-hidden className="size-4" />
                        {issues
                          .map((x) => t(`items.issue.${x}`, { min: BRIEF_MIN_CHARS }))
                          .join(" · ")}
                      </p>
                    ) : null}
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="grid gap-1">
                        <Label htmlFor={`${p}-title`}>{t("items.title")}</Label>
                        <Input
                          id={`${p}-title`}
                          value={it.title}
                          maxLength={160}
                          onChange={(e) => setItem(i, { title: e.target.value })}
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor={`${p}-objective`}>{t("items.objective")}</Label>
                        <select
                          id={`${p}-objective`}
                          className={controlClass}
                          value={it.objective ?? ""}
                          onChange={(e) =>
                            setItem(i, {
                              objective: (e.target.value || null) as AutomationItem["objective"],
                            })
                          }
                        >
                          <option value="">{t("items.chooseObjective")}</option>
                          {contentObjectives.map((o) => (
                            <option key={o} value={o}>
                              {tl(`objective.${o}`)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`${p}-brief`}>{t("items.brief")}</Label>
                      <textarea
                        id={`${p}-brief`}
                        className={controlClass}
                        rows={3}
                        maxLength={2000}
                        value={it.brief}
                        onChange={(e) => setItem(i, { brief: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="grid gap-1">
                        <Label htmlFor={`${p}-pillar`}>{t("items.pillar")}</Label>
                        <select
                          id={`${p}-pillar`}
                          className={controlClass}
                          value={it.pillarId ?? ""}
                          onChange={(e) =>
                            setItem(i, { pillarId: e.target.value || null, rubricId: null })
                          }
                        >
                          <option value="">{t("items.none")}</option>
                          {options.pillars.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor={`${p}-rubric`}>{t("items.rubric")}</Label>
                        <select
                          id={`${p}-rubric`}
                          className={controlClass}
                          value={it.rubricId ?? ""}
                          onChange={(e) => setItem(i, { rubricId: e.target.value || null })}
                        >
                          <option value="">{t("items.none")}</option>
                          {rubrics.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor={`${p}-audience`}>{t("items.audienceNote")}</Label>
                        <Input
                          id={`${p}-audience`}
                          value={it.audienceNote}
                          maxLength={300}
                          onChange={(e) => setItem(i, { audienceNote: e.target.value })}
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor={`${p}-cta`}>{t("items.cta")}</Label>
                        <Input
                          id={`${p}-cta`}
                          value={it.cta}
                          maxLength={200}
                          onChange={(e) => setItem(i, { cta: e.target.value })}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            {source === "briefs" ? (
              <div className="grid gap-3">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="w-fit"
                  disabled={room <= 0}
                  onClick={() => {
                    setItems((all) => [...all, blank()]);
                    touch();
                  }}
                >
                  <Plus aria-hidden className="size-4" />
                  {t("items.add")}
                </Button>
                <div className="grid gap-1">
                  <Label htmlFor="au-paste">{t("items.paste")}</Label>
                  <p id="au-paste-help" className="text-body-sm text-fg-muted">
                    {t("items.pasteHelp")}
                  </p>
                  <textarea
                    id="au-paste"
                    aria-describedby="au-paste-help"
                    className={controlClass}
                    rows={3}
                    value={paste}
                    onChange={(e) => setPaste(e.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="w-fit"
                    disabled={!paste.trim() || room <= 0}
                    onClick={addPasted}
                  >
                    {t("items.pasteAdd")}
                  </Button>
                </div>
              </div>
            ) : null}
            {room <= 0 ? (
              <p className="text-body-sm text-fg-muted">
                {t("items.max", { max: AUTOMATION_MAX_ITEMS })}
              </p>
            ) : null}
          </Card>

          <Card className="grid gap-4 p-5">
            <h2 className="text-heading-sm text-fg">{t("params.heading")}</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor="au-format">{t("params.format")}</Label>
                <select
                  id="au-format"
                  className={controlClass}
                  value={params.format}
                  onChange={(e) => {
                    setParams({
                      ...params,
                      format: e.target.value as AutomationParams["format"],
                      templateKey: null,
                    });
                    touch();
                  }}
                >
                  {formats.map((f) => (
                    <option key={f} value={f}>
                      {tf(f)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="au-template">{t("params.template")}</Label>
                <select
                  id="au-template"
                  className={controlClass}
                  value={params.templateKey ?? ""}
                  onChange={(e) => {
                    setParams({ ...params, templateKey: e.target.value || null });
                    touch();
                  }}
                >
                  <option value="">{t("params.templateAuto")}</option>
                  {templatesOfFormat.map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="au-slides">{t("params.slideCount")}</Label>
                <Input
                  id="au-slides"
                  type="number"
                  min={1}
                  max={20}
                  placeholder={t("params.slideCountDefault")}
                  value={params.slideCount ?? ""}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setParams({
                      ...params,
                      slideCount: e.target.value && n >= 1 && n <= 20 ? Math.round(n) : null,
                    });
                    touch();
                  }}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="au-language">{t("params.language")}</Label>
                <select
                  id="au-language"
                  className={controlClass}
                  value={params.language}
                  onChange={(e) => {
                    setParams({
                      ...params,
                      language: e.target.value as AutomationParams["language"],
                    });
                    touch();
                  }}
                >
                  {contentLanguages.map((l) => (
                    <option key={l.code} value={l.code}>
                      {tl(`language.${l.code}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-body-sm text-fg-muted">{t("params.audiencesAll")}</p>
          </Card>

          <Card className="grid gap-3 p-5">
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-heading-sm text-fg">{t("stop.heading")}</legend>
              {(["outline", "slides"] as const).map((s) => (
                <label key={s} className="flex items-start gap-2 text-body-sm text-fg">
                  <input
                    type="radio"
                    name="au-stop"
                    value={s}
                    checked={stopAt === s}
                    onChange={() => {
                      setStopAt(s);
                      touch();
                    }}
                  />
                  {t(`stop.${s}`)}
                </label>
              ))}
            </fieldset>
            <p className="text-body-sm text-fg-muted">{t("stop.help")}</p>
            <p className="text-body-sm text-fg-muted">{t("stop.images")}</p>
          </Card>
        </fieldset>

        {!readOnly ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={save} disabled={pending || !dirty}>
              <Save aria-hidden className="size-4" />
              {t("save")}
            </Button>
            <span role="status" className="text-body-sm text-fg-muted">
              {pending ? t("saving") : dirty ? t("unsaved") : saved ? t("saved") : null}
            </span>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-body-sm text-error">
            {error}
          </p>
        ) : null}
      </div>

      <aside aria-labelledby="au-summary" className="xl:col-span-4">
        <Card className="grid gap-3 p-5 xl:sticky xl:top-6">
          <h2 id="au-summary" className="text-heading-sm text-fg">
            {t("summary.heading")}
          </h2>
          <p className="text-body-sm text-fg">
            {t("summary.items", { valid, incomplete: items.length - valid })}
          </p>
          <p className="text-body-sm text-fg">{ta(`stopAt.${stopAt}`)}</p>
          <dl className="grid gap-2 text-body-sm">
            <div>
              <dt className="text-fg-muted">{t("summary.policy")}</dt>
              <dd className="text-fg">{summary.policy}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">{t("summary.estimate")}</dt>
              <dd className="text-fg">
                {t("summary.estimateValue", {
                  low: money(estimate.low),
                  high: money(estimate.high),
                })}
              </dd>
            </div>
            {(["client", "agency"] as const).map((scope) => {
              const b = summary.budgets.find((x) => x.scope === scope);
              return (
                <div key={scope}>
                  <dt className="text-fg-muted">
                    {t(scope === "client" ? "summary.budgetClient" : "summary.budgetAgency")}
                  </dt>
                  <dd className="text-fg">
                    {b
                      ? t("summary.budgetValue", {
                          left: money(b.leftMicroUsd),
                          limit: money(b.limitMicroUsd),
                        })
                      : t("summary.noLimit")}
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className="text-body-sm text-fg">
            {estimate.exhausted
              ? t("summary.exhausted")
              : estimate.fits !== null
                ? t("summary.exceeds", { count: estimate.fits })
                : estimate.needsConfirmation
                  ? t("summary.confirm")
                  : t("summary.fits")}
          </p>
          {canStart ? (
            <>
              {blockers.length ? (
                <ul className="grid gap-1 text-body-sm text-fg-muted">
                  {blockers.map((b) => (
                    <li key={b} className="flex items-center gap-2">
                      <CircleAlert aria-hidden className="size-4" />
                      {t(`summary.blocked.${b}`)}
                    </li>
                  ))}
                </ul>
              ) : null}
              {confirming ? (
                <div className="grid gap-3 rounded-md border border-subtle p-3">
                  <p className="text-body-sm text-fg">
                    {t("summary.start", { count: items.length })} · {summary.clientName}
                  </p>
                  {estimate.needsConfirmation ? (
                    <label className="flex items-center gap-2 text-body-sm text-fg">
                      <input
                        type="checkbox"
                        checked={confirmCost}
                        onChange={(e) => setConfirmCost(e.target.checked)}
                      />
                      {t("summary.confirmCost")}
                    </label>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      onClick={launch}
                      disabled={pending || (estimate.needsConfirmation && !confirmCost)}
                    >
                      <Play aria-hidden className="size-4" />
                      {t("summary.start", { count: items.length })}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                      {ta("new.cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={pending || blockers.length > 0}
                >
                  <Play aria-hidden className="size-4" />
                  {t("summary.start", { count: items.length })}
                </Button>
              )}
            </>
          ) : null}
        </Card>
      </aside>
    </div>
  );
}
