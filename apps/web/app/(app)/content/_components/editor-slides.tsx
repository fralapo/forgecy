"use client";

import {
  newSlideId,
  type CarouselDocument,
  type ContentCheck,
  type ContentSlide,
} from "@forgecy/content/client";
import {
  findLayout,
  visibleLength,
  type ImageRef,
  type LayoutDef,
  type SlotDef,
  type TemplateManifest,
} from "@forgecy/carousel";
import { Badge, Button, Input, Label, cn } from "@forgecy/ui";
import { ArrowDown, ArrowUp, Copy, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { updateAltAction } from "../actions";
import { ActionButton, controlClass } from "./action-button";
import { AiImageDrafts, ImageGenerator, Thumb } from "./editor-ai";
import type { EditorAsset, EditorRef } from "./editor-workspace";

type Update = (fn: (d: CarouselDocument) => CarouselDocument) => void;

/** Whether `layout` may sit at `index` in a carousel of `total` slides (template position rules). */
function allowedAt(m: TemplateManifest, layout: LayoutDef, index: number, total: number) {
  const last = index === total - 1;
  if (layout.position === "first" && index !== 0) return false;
  if (layout.position === "last" && !last) return false;
  if (m.rules.ctaOnlyLast && layout.role === "cta" && !last) return false;
  return true;
}

/** “Name · role” label of a layout, with the role translated. */
function useLayoutLabel() {
  const tl = useTranslations("content.labels.slideRole");
  return (l: LayoutDef) => `${l.name} · ${tl(l.role)}`;
}

/** Keeps the values that still fit the new layout (same slot name and type). */
function moveSlots(slide: ContentSlide, from: LayoutDef | undefined, to: LayoutDef) {
  const slots: ContentSlide["slots"] = {};
  for (const def of to.slots) {
    const value = slide.slots[def.name];
    const old = from?.slots.find((s) => s.name === def.name);
    if (value !== undefined && (!from || old?.type === def.type)) slots[def.name] = value;
  }
  return {
    ...slide,
    layout: to.id,
    role: to.role,
    slots,
    protectedSlots: slide.protectedSlots.filter((n) => to.slots.some((s) => s.name === n)),
  };
}

export function SlideList({
  doc,
  manifest,
  checks,
  selectedId,
  onSelect,
  update,
  readOnly,
}: {
  doc: CarouselDocument;
  manifest: TemplateManifest;
  checks: ContentCheck[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  update: Update;
  readOnly: boolean;
}) {
  const t = useTranslations("content.editor.slides");
  const tl = useTranslations("content.labels.slideRole");
  const layoutLabel = useLayoutLabel();
  const n = doc.slides.length;
  const { min, max } = manifest.slides;
  const at =
    Math.max(
      0,
      doc.slides.findIndex((s) => s.id === selectedId),
    ) + (n ? 1 : 0);
  const options = manifest.layouts.filter((l) => allowedAt(manifest, l, at, n + 1));
  const [layoutId, setLayoutId] = useState("");
  const chosen = options.find((l) => l.id === layoutId) ?? options[0];

  const move = (i: number, d: -1 | 1) =>
    update((doc) => {
      const slides = [...doc.slides];
      const j = i + d;
      if (j < 0 || j >= slides.length) return doc;
      [slides[i], slides[j]] = [slides[j]!, slides[i]!];
      return { ...doc, slides };
    });

  return (
    <nav aria-label={t("navLabel")} className="space-y-3">
      <p className="text-body-sm text-fg-muted">{t("count", { count: n, min, max })}</p>
      <ol className="space-y-2">
        {doc.slides.map((s, i) => {
          const layout = findLayout(manifest, s.layout);
          const own = checks.filter((c) => c.slideId === s.id);
          const errors = own.filter((c) => c.severity === "error").length;
          const warnings = own.length - errors;
          const current = s.id === selectedId;
          return (
            <li
              key={s.id}
              className={cn(
                "rounded-md border bg-surface p-2",
                current ? "border-primary" : "border-subtle",
              )}
            >
              <button
                type="button"
                aria-current={current ? "true" : undefined}
                className="w-full text-left"
                onClick={() => onSelect(s.id)}
              >
                <span className="block text-body-sm text-fg">
                  {i + 1}. {layout ? layout.name : s.layout}
                </span>
                <span className="block text-label text-fg-muted">
                  {layout ? tl(layout.role) : t("layoutMissing")}
                </span>
              </button>
              {errors || warnings ? (
                <span className="mt-1 flex flex-wrap gap-1">
                  {errors ? <Badge variant="error">{errors}</Badge> : null}
                  {warnings ? <Badge variant="warning">{warnings}</Badge> : null}
                </span>
              ) : null}
              {!readOnly ? (
                <span className="mt-1 flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("moveUp", { number: i + 1 })}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("moveDown", { number: i + 1 })}
                    disabled={i === n - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("duplicate", { number: i + 1 })}
                    disabled={n >= max}
                    onClick={() => {
                      const copy = { ...structuredClone(s), id: newSlideId() };
                      update((d) => {
                        const slides = [...d.slides];
                        slides.splice(i + 1, 0, copy);
                        return { ...d, slides };
                      });
                      onSelect(copy.id);
                    }}
                  >
                    <Copy aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("delete", { number: i + 1 })}
                    disabled={n <= min}
                    onClick={() => {
                      if (!window.confirm(t("deleteConfirm", { number: i + 1 }))) return;
                      update((d) => ({ ...d, slides: d.slides.filter((x) => x.id !== s.id) }));
                      const next = doc.slides[i + 1] ?? doc.slides[i - 1];
                      if (next) onSelect(next.id);
                    }}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {!readOnly ? (
        <div className="space-y-2 rounded-md border border-dashed border-subtle p-2">
          <Label htmlFor="add-layout">{t("newSlide")}</Label>
          <select
            id="add-layout"
            className={controlClass}
            value={chosen?.id ?? ""}
            disabled={n >= max || !options.length}
            onChange={(e) => setLayoutId(e.target.value)}
          >
            {options.map((l) => (
              <option key={l.id} value={l.id}>
                {layoutLabel(l)}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            size="sm"
            disabled={n >= max || !chosen}
            onClick={() => {
              if (!chosen) return;
              const slide: ContentSlide = {
                id: newSlideId(),
                layout: chosen.id,
                role: chosen.role,
                tone: "default",
                slots: {},
                protectedSlots: [],
              };
              update((d) => {
                const slides = [...d.slides];
                slides.splice(at, 0, slide);
                return { ...d, slides };
              });
              onSelect(slide.id);
            }}
          >
            <Plus aria-hidden />
            {t("add")}
          </Button>
          {n >= max ? <p className="text-body-sm text-fg-muted">{t("maxReached")}</p> : null}
        </div>
      ) : null}
    </nav>
  );
}

export function SlidePanel({
  editorRef,
  slide,
  index,
  total,
  manifest,
  library,
  update,
  readOnly,
  flush,
}: {
  editorRef: EditorRef;
  slide: ContentSlide;
  index: number;
  total: number;
  manifest: TemplateManifest;
  library: EditorAsset[];
  update: Update;
  readOnly: boolean;
  flush: () => Promise<boolean>;
}) {
  const t = useTranslations("content.editor.slide");
  const layoutLabel = useLayoutLabel();
  const layout = findLayout(manifest, slide.layout);
  const layouts = manifest.layouts.filter(
    (l) => l.id === slide.layout || allowedAt(manifest, l, index, total),
  );
  const patch = (fn: (s: ContentSlide) => ContentSlide) =>
    update((d) => ({ ...d, slides: d.slides.map((s) => (s.id === slide.id ? fn(s) : s)) }));
  const setSlot = (name: string, value: ContentSlide["slots"][string] | undefined) =>
    patch((s) => {
      const slots = { ...s.slots };
      if (value === undefined) delete slots[name];
      else slots[name] = value;
      return { ...s, slots };
    });
  const toggleProtected = (name: string, on: boolean) =>
    patch((s) => ({
      ...s,
      protectedSlots: on
        ? [...new Set([...s.protectedSlots, name])]
        : s.protectedSlots.filter((x) => x !== name),
    }));

  return (
    <section
      aria-labelledby="slide-title"
      className="space-y-4 rounded-lg border border-subtle bg-surface p-4"
    >
      <h2 id="slide-title" className="text-heading-sm text-fg">
        {t("title", { number: index + 1 })}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="slide-layout">{t("layout")}</Label>
          <select
            id="slide-layout"
            className={controlClass}
            value={slide.layout}
            disabled={readOnly}
            onChange={(e) => {
              const to = findLayout(manifest, e.target.value);
              if (to) patch((s) => moveSlots(s, layout, to));
            }}
          >
            {!layout ? (
              <option value={slide.layout}>
                {t("layoutUnavailable", { layout: slide.layout })}
              </option>
            ) : null}
            {layouts.map((l) => (
              <option key={l.id} value={l.id}>
                {layoutLabel(l)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="slide-tone">{t("tone")}</Label>
          <select
            id="slide-tone"
            className={controlClass}
            value={slide.tone}
            disabled={readOnly}
            onChange={(e) => {
              const tone = e.target.value === "inverse" ? "inverse" : "default";
              patch((s) => ({ ...s, tone }));
            }}
          >
            <option value="default">{t("toneDefault")}</option>
            <option value="inverse">{t("toneInverse")}</option>
          </select>
        </div>
      </div>

      {layout ? (
        layout.slots.map((def) => (
          <SlotField
            key={def.name}
            editorRef={editorRef}
            slideId={slide.id}
            def={def}
            value={slide.slots[def.name]}
            isProtected={slide.protectedSlots.includes(def.name)}
            onProtect={(on) => toggleProtected(def.name, on)}
            onChange={(v) => setSlot(def.name, v)}
            library={library}
            readOnly={readOnly}
            flush={flush}
          />
        ))
      ) : (
        <p className="text-body-sm text-error">{t("layoutMissing", { layout: slide.layout })}</p>
      )}

      <div className="space-y-1">
        <Label htmlFor="slide-note">{t("note")}</Label>
        <Input
          id="slide-note"
          value={slide.note ?? ""}
          maxLength={300}
          disabled={readOnly}
          onChange={(e) => {
            const note = e.target.value;
            patch((s) => ({ ...s, note: note || undefined }));
          }}
        />
      </div>
    </section>
  );
}

type SlotValue = ContentSlide["slots"][string];

function Counter({ len, max, id }: { len: number; max: number; id?: string }) {
  return (
    <span id={id} className={len > max ? "text-label text-error" : "text-label text-fg-muted"}>
      {len}/{max}
    </span>
  );
}

function SlotField({
  editorRef,
  slideId,
  def,
  value,
  isProtected,
  onProtect,
  onChange,
  library,
  readOnly,
  flush,
}: {
  editorRef: EditorRef;
  slideId: string;
  def: SlotDef;
  value: SlotValue | undefined;
  isProtected: boolean;
  onProtect: (on: boolean) => void;
  onChange: (v: SlotValue | undefined) => void;
  library: EditorAsset[];
  readOnly: boolean;
  flush: () => Promise<boolean>;
}) {
  const t = useTranslations("content.editor.slot");
  const id = `slot-${def.name}`;
  const label = def.label ?? def.name;
  return (
    // A group named by the slot; a text slot's name is a real <label> of its field, so a
    // click on it focuses the field and checkers find the association.
    <div
      role="group"
      aria-labelledby={`${id}-name`}
      className="space-y-2 border-t border-subtle pt-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {def.type === "text" ? (
          <label id={`${id}-name`} htmlFor={id} className="text-body-sm font-medium text-fg">
            {label}
            {def.required ? <span className="text-fg-muted"> · {t("required")}</span> : null}
          </label>
        ) : (
          <span id={`${id}-name`} className="text-body-sm font-medium text-fg">
            {label}
            {def.required ? <span className="text-fg-muted"> · {t("required")}</span> : null}
          </span>
        )}
        <label className="flex items-center gap-2 text-body-sm text-fg">
          <input
            type="checkbox"
            className="size-4"
            checked={isProtected}
            disabled={readOnly}
            onChange={(e) => onProtect(e.target.checked)}
          />
          <ShieldCheck aria-hidden className="size-4" />
          {t("protect")}
          <span className="sr-only">: {label}</span>
        </label>
      </div>

      {def.type === "text" ? (
        <TextSlot
          id={id}
          def={def}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
          readOnly={readOnly}
        />
      ) : def.type === "list" ? (
        <ListSlot
          id={id}
          def={def}
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
          readOnly={readOnly}
        />
      ) : (
        <ImageSlot
          editorRef={editorRef}
          slideId={slideId}
          slot={def.name}
          value={value && typeof value === "object" && !Array.isArray(value) ? value : undefined}
          onChange={onChange}
          library={library}
          readOnly={readOnly}
          flush={flush}
        />
      )}
    </div>
  );
}

function TextSlot({
  id,
  def,
  value,
  onChange,
  readOnly,
}: {
  id: string;
  def: Extract<SlotDef, { type: "text" }>;
  value: string;
  onChange: (v: SlotValue | undefined) => void;
  readOnly: boolean;
}) {
  const t = useTranslations("content.editor.slot");
  const multiline = (def.maxLines ?? 2) > 1 || def.maxChars > 80;
  const common = {
    id,
    value,
    disabled: readOnly,
    "aria-describedby": `${id}-count`,
  };
  return (
    <div className="space-y-1">
      {multiline ? (
        <textarea
          {...common}
          rows={Math.min(def.maxLines ?? 3, 8)}
          className={controlClass}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      ) : (
        <Input {...common} onChange={(e) => onChange(e.target.value || undefined)} />
      )}
      <p className="flex flex-wrap justify-between gap-2 text-label text-fg-muted">
        <span>
          {def.maxLines ? `${t("maxLines", { count: def.maxLines })} ` : ""}
          {def.highlight ? t("highlight") : ""}
        </span>
        <Counter id={`${id}-count`} len={visibleLength(value)} max={def.maxChars} />
      </p>
    </div>
  );
}

function ListSlot({
  id,
  def,
  value,
  onChange,
  readOnly,
}: {
  id: string;
  def: Extract<SlotDef, { type: "list" }>;
  value: string[];
  onChange: (v: SlotValue | undefined) => void;
  readOnly: boolean;
}) {
  const t = useTranslations("content.editor.slot");
  const set = (items: string[]) => onChange(items.length ? items : undefined);
  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {value.map((item, i) => (
          <li key={i} className="flex items-center gap-2">
            <Input
              value={item}
              disabled={readOnly}
              aria-label={t("item", { label: def.label ?? def.name, number: i + 1 })}
              aria-describedby={`${id}-${i}-count`}
              onChange={(e) => set(value.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <Counter id={`${id}-${i}-count`} len={visibleLength(item)} max={def.maxChars} />
            {!readOnly ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("removeItem", { number: i + 1 })}
                onClick={() => set(value.filter((_, j) => j !== i))}
              >
                <X aria-hidden />
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        {!readOnly ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={value.length >= def.maxItems}
            onClick={() => set([...value, ""])}
          >
            <Plus aria-hidden />
            {t("addItem")}
          </Button>
        ) : null}
        <span className="text-label text-fg-muted">
          {t("itemCount", { count: value.length, min: def.minItems, max: def.maxItems })}
        </span>
      </div>
    </div>
  );
}

function ImageSlot({
  editorRef,
  slideId,
  slot,
  value,
  onChange,
  library,
  readOnly,
  flush,
}: {
  editorRef: EditorRef;
  slideId: string;
  slot: string;
  value: ImageRef | undefined;
  onChange: (v: SlotValue | undefined) => void;
  library: EditorAsset[];
  readOnly: boolean;
  flush: () => Promise<boolean>;
}) {
  const t = useTranslations("content.editor.imageSlot");
  const [picking, setPicking] = useState(false);
  const current = value?.key ? library.find((a) => a.key === value.key) : undefined;
  const approved = library.filter((a) => a.status === "approved");
  const drafts = library.filter(
    (a) => a.source === "ai" && a.status === "draft" && a.slideId === slideId && a.slot === slot,
  );
  const use = (a: EditorAsset) => {
    onChange({ key: a.key, alt: a.alt, focalX: 0.5, focalY: 0.5 });
    setPicking(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-4">
        <div className="w-32">
          {value ? (
            <Thumb url={current?.thumb ?? null} alt={value.alt} />
          ) : (
            <div className="flex aspect-square w-full items-center justify-center rounded-md border border-dashed border-subtle text-body-sm text-fg-muted">
              {t("none")}
            </div>
          )}
        </div>
        <div className="min-w-48 flex-1 space-y-2">
          {value?.asset ? <p className="text-body-sm text-fg-muted">{t("sample")}</p> : null}
          {current && current.status !== "approved" ? (
            <Badge variant="warning">{t("toApprove")}</Badge>
          ) : null}
          {value ? (
            <div className="space-y-1">
              <Label htmlFor={`alt-${slideId}-${slot}`}>{t("alt")}</Label>
              <Input
                id={`alt-${slideId}-${slot}`}
                value={value.alt}
                maxLength={300}
                disabled={readOnly}
                onChange={(e) => onChange({ ...value, alt: e.target.value })}
              />
              {current && value.alt.trim() && value.alt !== current.alt && !readOnly ? (
                <ActionButton
                  variant="ghost"
                  size="sm"
                  action={() =>
                    updateAltAction({
                      slug: editorRef.slug,
                      clientId: editorRef.clientId,
                      id: current.id,
                      alt: value.alt,
                    })
                  }
                >
                  {t("altToLibrary")}
                </ActionButton>
              ) : null}
            </div>
          ) : null}
          {!readOnly ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPicking((p) => !p)}>
                {picking ? t("closeLibrary") : t("chooseLibrary")}
              </Button>
              {value ? (
                <Button variant="ghost" size="sm" onClick={() => onChange(undefined)}>
                  {t("remove")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {picking ? (
        approved.length ? (
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {approved.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className={cn(
                    "w-full rounded-md border p-1 text-left",
                    a.key === value?.key
                      ? "border-primary"
                      : "border-transparent hover:border-control",
                  )}
                  onClick={() => use(a)}
                >
                  <Thumb url={a.thumb} alt={a.alt} />
                  <span className="mt-1 block truncate text-label text-fg-muted">
                    {a.alt || t("noAlt")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body-sm text-fg-muted">{t("noApproved")}</p>
        )
      ) : null}

      <AiImageDrafts
        editorRef={editorRef}
        drafts={drafts}
        selectedKey={value?.key ?? null}
        onUse={use}
        readOnly={readOnly}
      />
      {!readOnly ? (
        <ImageGenerator editorRef={editorRef} slideId={slideId} slot={slot} flush={flush} />
      ) : null}
    </div>
  );
}
