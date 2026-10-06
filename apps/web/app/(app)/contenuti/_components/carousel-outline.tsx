"use client";

import { slideRoleLabels, slideRoles, type SlideRole } from "@forgecy/carousel";
import { newSlideId, type Outline, type OutlineRow } from "@forgecy/content/client";
import { Button, Input, Label } from "@forgecy/ui";
import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { generateOutlineAction, saveOutlineAction, type ActionResult } from "../actions";
import { controlClass } from "./action-button";

export interface LayoutOption {
  id: string;
  name: string;
  role: SlideRole;
}

interface Ref {
  slug: string;
  clientId: string;
  contentId: string;
}

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult>, after?: () => void) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
      else {
        after?.();
        router.refresh();
      }
    });
  };
  return { pending, error, run };
}

function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <span role="alert" className="text-body-sm text-error">
      {error}
    </span>
  ) : null;
}

/** «Genera scaletta» / «Rigenera»: an optional instruction for the Copywriter. */
export function CarouselOutlineGenerate({
  refs,
  hasOutline,
  disabled,
}: {
  refs: Ref;
  hasOutline: boolean;
  disabled: boolean;
}) {
  const { pending, error, run } = useRun();
  const [instruction, setInstruction] = useState("");
  const [keepEdited, setKeepEdited] = useState(true);
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            generateOutlineAction({
              slug: refs.slug,
              clientId: refs.clientId,
              id: refs.contentId,
              instruction,
              keepEdited: hasOutline ? keepEdited : false,
            }),
          () => setInstruction(""),
        );
      }}
    >
      <Label htmlFor="ol-instruction">Indicazioni per il Copywriter (facoltative)</Label>
      <textarea
        id="ol-instruction"
        rows={2}
        maxLength={500}
        className={controlClass}
        value={instruction}
        disabled={disabled || pending}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="Es. apri con un dato, chiudi con una domanda"
      />
      {hasOutline ? (
        <label className="flex items-center gap-2 text-body-sm text-fg">
          <input
            type="checkbox"
            checked={keepEdited}
            disabled={disabled || pending}
            onChange={(e) => setKeepEdited(e.target.checked)}
          />
          Mantieni le righe modificate a mano
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant={hasOutline ? "secondary" : "primary"}
          disabled={disabled || pending}
        >
          <Sparkles aria-hidden />
          {hasOutline ? "Rigenera" : "Genera scaletta"}
        </Button>
        <ErrorText error={error} />
      </div>
    </form>
  );
}

const emptyOutline = (count: number, layouts: LayoutOption[]): Outline => ({
  title: "",
  hook: "",
  cta: "",
  caption: "",
  hashtags: [],
  rows: Array.from({ length: Math.max(1, count) }, (_, i) => {
    const role: SlideRole = i === 0 ? "cover" : i === count - 1 && count > 1 ? "cta" : "text";
    const layout = layouts.find((l) => l.role === role) ?? layouts[0];
    return {
      id: newSlideId(),
      role,
      point: "",
      layout: layout?.id ?? role,
      note: "",
      edited: true,
    };
  }),
});

/** Outline rows editor: points, roles and layouts of the template; saved as a new outline. */
export function CarouselOutlineEditor({
  refs,
  outline,
  outlineNumber,
  layouts,
  slideCount,
  editable,
}: {
  refs: Ref;
  outline: Outline | null;
  outlineNumber: number;
  layouts: LayoutOption[];
  slideCount: number;
  editable: boolean;
}) {
  const { pending, error, run } = useRun();
  const [o, setO] = useState<Outline | null>(outline);
  const [hashtags, setHashtags] = useState((outline?.hashtags ?? []).join(" "));
  const [dirty, setDirty] = useState(false);

  if (!o)
    return (
      <Button
        type="button"
        variant="secondary"
        disabled={!editable}
        onClick={() => setO(emptyOutline(slideCount, layouts))}
      >
        Scrivi la scaletta a mano
      </Button>
    );

  const patch = (p: Partial<Outline>) => {
    setO({ ...o, ...p });
    setDirty(true);
  };
  const setRow = (i: number, p: Partial<OutlineRow>) =>
    patch({ rows: o.rows.map((r, j) => (j === i ? { ...r, ...p, edited: true } : r)) });
  const move = (i: number, d: -1 | 1) => {
    const rows = [...o.rows];
    const [r] = rows.splice(i, 1);
    rows.splice(i + d, 0, r!);
    patch({ rows });
  };
  const layoutsFor = (role: SlideRole) => {
    const own = layouts.filter((l) => l.role === role);
    return own.length ? own : layouts;
  };
  // Only the roles this template has a layout for (a social template has no report pages);
  // the row's current role stays listed so the select never shows a value it lacks.
  const rolesFor = (current: SlideRole) =>
    slideRoles.filter((x) => x === current || layouts.some((l) => l.role === x));

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            saveOutlineAction({
              slug: refs.slug,
              clientId: refs.clientId,
              id: refs.contentId,
              outlineNumber,
              outline: {
                ...o,
                hashtags: hashtags
                  .split(/[\s,]+/)
                  .map((h) => h.trim())
                  .filter(Boolean),
              },
            }),
          () => setDirty(false),
        );
      }}
    >
      <fieldset disabled={!editable || pending} className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="ol-title">Titolo</Label>
            <Input
              id="ol-title"
              maxLength={160}
              value={o.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ol-hook">Gancio</Label>
            <Input
              id="ol-hook"
              maxLength={200}
              value={o.hook}
              onChange={(e) => patch({ hook: e.target.value })}
            />
          </div>
        </div>
        <ol className="grid gap-3">
          {o.rows.map((r, i) => (
            <li key={r.id} className="grid gap-3 rounded-md border border-subtle p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-label text-fg">Slide {i + 1}</span>
                {r.edited ? (
                  <span className="text-body-sm text-fg-muted">· modificata a mano</span>
                ) : null}
                <span className="ml-auto flex gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    title="Sposta su"
                    aria-label={`Sposta su la slide ${i + 1}`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    title="Sposta giù"
                    aria-label={`Sposta giù la slide ${i + 1}`}
                    disabled={i === o.rows.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    title="Elimina"
                    aria-label={`Elimina la slide ${i + 1}`}
                    disabled={o.rows.length <= 1}
                    onClick={() => patch({ rows: o.rows.filter((_, j) => j !== i) })}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-1">
                  <Label htmlFor={`ol-role-${r.id}`}>Ruolo</Label>
                  <select
                    id={`ol-role-${r.id}`}
                    className={controlClass}
                    value={r.role}
                    onChange={(e) => {
                      const role = e.target.value as SlideRole;
                      const ok = layoutsFor(role).some((l) => l.id === r.layout);
                      setRow(i, {
                        role,
                        ...(ok ? {} : { layout: layoutsFor(role)[0]?.id ?? r.layout }),
                      });
                    }}
                  >
                    {rolesFor(r.role).map((x) => (
                      <option key={x} value={x}>
                        {slideRoleLabels[x]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`ol-layout-${r.id}`}>Layout</Label>
                  <select
                    id={`ol-layout-${r.id}`}
                    className={controlClass}
                    value={r.layout}
                    onChange={(e) => setRow(i, { layout: e.target.value })}
                  >
                    {layoutsFor(r.role).some((l) => l.id === r.layout) ? null : (
                      <option value={r.layout}>{r.layout}</option>
                    )}
                    {layoutsFor(r.role).map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`ol-point-${r.id}`}>Punto</Label>
                <textarea
                  id={`ol-point-${r.id}`}
                  rows={2}
                  maxLength={280}
                  className={controlClass}
                  value={r.point}
                  onChange={(e) => setRow(i, { point: e.target.value })}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`ol-note-${r.id}`}>Nota</Label>
                <Input
                  id={`ol-note-${r.id}`}
                  maxLength={300}
                  value={r.note}
                  onChange={(e) => setRow(i, { note: e.target.value })}
                />
              </div>
            </li>
          ))}
        </ol>
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={o.rows.length >= 20}
            onClick={() =>
              patch({
                rows: [
                  ...o.rows,
                  {
                    id: newSlideId(),
                    role: "text",
                    point: "",
                    layout: layoutsFor("text")[0]?.id ?? "text",
                    note: "",
                    edited: true,
                  },
                ],
              })
            }
          >
            <Plus aria-hidden />
            Aggiungi slide
          </Button>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ol-cta">Call to action</Label>
          <Input
            id="ol-cta"
            maxLength={200}
            value={o.cta}
            onChange={(e) => patch({ cta: e.target.value })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ol-caption">Didascalia</Label>
          <textarea
            id="ol-caption"
            rows={4}
            maxLength={3000}
            className={controlClass}
            value={o.caption}
            onChange={(e) => patch({ caption: e.target.value })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ol-hashtags">Hashtag</Label>
          <Input
            id="ol-hashtags"
            value={hashtags}
            onChange={(e) => {
              setHashtags(e.target.value);
              setDirty(true);
            }}
            placeholder="#esempio #altro"
          />
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!editable || pending || !dirty}>
          Salva scaletta
        </Button>
        {dirty ? <span className="text-body-sm text-fg-muted">Modifiche non salvate</span> : null}
        <ErrorText error={error} />
      </div>
    </form>
  );
}
