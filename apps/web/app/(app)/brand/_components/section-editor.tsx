"use client";

import { newItemId, wordCount } from "@forgecy/brand/client";
import { Badge, Button, Input, Label } from "@forgecy/ui";
import { Plus, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { saveSectionAction } from "../actions";
import type { Ctl, FieldUi, SectionUi } from "../_lib/editor-config";
import { plural } from "@/lib/plural";

type Obj = Record<string, unknown>;
type SourceOption = { id: string; title: string };

export const controlClass =
  "w-full rounded-md border border-control bg-surface px-3 py-2 text-body-sm text-fg focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-70";

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const sourcedItem = (value: unknown) => ({
  id: newItemId(),
  value,
  sourceIds: [],
  confidence: "high",
});

/** Drops empty strings, empty items and unset numbers before saving. */
function clean(v: unknown): unknown {
  if (typeof v === "string") return v.trim() === "" ? undefined : v;
  if (Array.isArray(v)) return v.map(clean).filter((x) => x !== undefined);
  if (!isObj(v)) return v;
  const out: Obj = {};
  for (const [k, x] of Object.entries(v)) {
    const c = clean(x);
    if (c !== undefined) out[k] = c;
  }
  if ("sourceIds" in v && "id" in v) {
    const value = out.value;
    if (value === undefined || (isObj(value) && Object.keys(value).length === 0)) return undefined;
    return out;
  }
  return Object.keys(out).some((k) => k !== "id") ? out : undefined;
}

function LinesInput({
  id,
  value,
  onChange,
  separator = "\n",
  disabled,
}: {
  id: string;
  value: unknown;
  onChange(v: string[]): void;
  separator?: "\n" | ",";
  disabled: boolean;
}) {
  const join = separator === "\n" ? "\n" : ", ";
  const [text, setText] = useState(Array.isArray(value) ? value.join(join) : "");
  return (
    <textarea
      id={id}
      className={controlClass}
      rows={separator === "\n" ? 3 : 1}
      value={text}
      disabled={disabled}
      onChange={(e) => {
        setText(e.target.value);
        onChange(
          e.target.value
            .split(separator)
            .map((s) => s.trim())
            .filter(Boolean),
        );
      }}
    />
  );
}

function Control({
  ctl,
  obj,
  set,
  sources,
  disabled,
}: {
  ctl: Ctl;
  obj: Obj;
  set(next: Obj): void;
  sources: SourceOption[];
  disabled: boolean;
}) {
  const id = useId();
  const v = obj[ctl.key];
  const put = (x: unknown) => set({ ...obj, [ctl.key]: x });
  let input;
  switch (ctl.kind) {
    case "text":
      input = (
        <Input
          id={id}
          value={typeof v === "string" ? v : ""}
          disabled={disabled}
          onChange={(e) => put(e.target.value)}
        />
      );
      break;
    case "textarea":
      input = (
        <textarea
          id={id}
          rows={3}
          className={controlClass}
          value={typeof v === "string" ? v : ""}
          disabled={disabled}
          onChange={(e) => put(e.target.value)}
        />
      );
      break;
    case "number":
    case "scale":
      input = (
        <Input
          id={id}
          type="number"
          min={ctl.min}
          max={ctl.max}
          value={typeof v === "number" ? v : ""}
          disabled={disabled}
          onChange={(e) => put(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );
      break;
    case "select":
      input = (
        <select
          id={id}
          className={controlClass}
          value={typeof v === "string" ? v : ""}
          disabled={disabled}
          onChange={(e) => put(e.target.value || undefined)}
        >
          {ctl.required && v ? null : <option value="">—</option>}
          {ctl.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case "source":
      input = (
        <select
          id={id}
          className={controlClass}
          value={typeof v === "string" ? v : ""}
          disabled={disabled}
          onChange={(e) => put(e.target.value || undefined)}
        >
          <option value="">No file</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      );
      break;
    case "lines":
      input = <LinesInput id={id} value={v} onChange={put} disabled={disabled} />;
      break;
    case "numbers":
      input = (
        <LinesInput
          id={id}
          value={v}
          separator=","
          onChange={(xs) => put(xs.map(Number).filter((n) => Number.isFinite(n)))}
          disabled={disabled}
        />
      );
      break;
    case "list":
      return (
        <fieldset className="space-y-2 sm:col-span-2">
          <legend className="text-label text-fg">{ctl.label}</legend>
          <ObjectList
            items={Array.isArray(v) ? (v as Obj[]) : []}
            item={ctl.item}
            withId={ctl.withId}
            addLabel={ctl.addLabel}
            onChange={put}
            sources={sources}
            disabled={disabled}
          />
        </fieldset>
      );
  }
  const wide = ctl.kind === "textarea" || ctl.kind === "lines";
  return (
    <div className={wide ? "space-y-1 sm:col-span-2" : "space-y-1"}>
      <Label htmlFor={id}>{ctl.label}</Label>
      {input}
      {"hint" in ctl && ctl.hint ? <p className="text-body-sm text-fg-muted">{ctl.hint}</p> : null}
    </div>
  );
}

function ObjectFields({
  item,
  obj,
  set,
  sources,
  disabled,
}: {
  item: Ctl[];
  obj: Obj;
  set(o: Obj): void;
  sources: SourceOption[];
  disabled: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {item.map((c) => (
        <Control key={c.key} ctl={c} obj={obj} set={set} sources={sources} disabled={disabled} />
      ))}
    </div>
  );
}

function ObjectList({
  items,
  item,
  withId,
  addLabel,
  onChange,
  sources,
  disabled,
  sourced,
}: {
  items: Obj[];
  item: Ctl[] | "text";
  withId?: boolean | undefined;
  addLabel: string;
  onChange(items: Obj[] | unknown[]): void;
  sources: SourceOption[];
  disabled: boolean;
  sourced?: boolean;
}) {
  const [keys] = useState(() => new WeakMap<object, string>());
  const keyOf = (o: Obj, i: number) => {
    if (typeof o.id === "string") return o.id;
    let k = keys.get(o);
    if (!k) keys.set(o, (k = `${i}-${newItemId()}`));
    return k;
  };
  const replace = (i: number, next: Obj) => onChange(items.map((x, j) => (j === i ? next : x)));
  return (
    <div className="space-y-3">
      {items.map((it, i) => {
        const inner = sourced ? it.value : it;
        const setInner = (next: unknown) =>
          replace(i, sourced ? { ...it, value: next } : (next as Obj));
        return (
          <div key={keyOf(it, i)} className="rounded-md border border-subtle bg-app p-3">
            {sourced ? <Provenance item={it} /> : null}
            {item === "text" ? (
              <Input
                aria-label={addLabel}
                value={typeof inner === "string" ? inner : ""}
                disabled={disabled}
                onChange={(e) => setInner(e.target.value)}
              />
            ) : (
              <ObjectFields
                item={item}
                obj={isObj(inner) ? inner : {}}
                set={setInner}
                sources={sources}
                disabled={disabled}
              />
            )}
            {!disabled ? (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
              >
                <Trash2 aria-hidden />
                Remove
              </Button>
            ) : null}
          </div>
        );
      })}
      {!disabled ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const blank = item === "text" ? "" : {};
            const base = withId && !sourced ? { id: newItemId() } : {};
            onChange([...items, sourced ? sourcedItem(blank) : { ...base, ...(blank as Obj) }]);
          }}
        >
          <Plus aria-hidden />
          {addLabel}
        </Button>
      ) : null}
    </div>
  );
}

function Provenance({ item }: { item: Obj }) {
  const n = Array.isArray(item.sourceIds) ? item.sourceIds.length : 0;
  if (!("sourceIds" in item)) return null;
  return (
    <p className="mb-2 text-body-sm text-fg-muted">
      {n ? `From ${n === 1 ? "one source" : `${n} sources`}` : "Entered by hand"}
      {item.acceptedFromProposalId ? " · from an accepted proposal" : ""}
      {item.confidence && item.confidence !== "high"
        ? ` · ${item.confidence === "medium" ? "medium" : "low"} confidence`
        : ""}
    </p>
  );
}

function Field({
  field,
  value,
  onChange,
  sources,
  disabled,
  pendingHref,
  pending,
}: {
  field: FieldUi;
  value: unknown;
  onChange(v: unknown): void;
  sources: SourceOption[];
  disabled: boolean;
  pending: number;
  pendingHref: string;
}) {
  const id = useId();
  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor={id} className="text-heading-sm text-fg">
        {field.label}
      </Label>
      {pending ? (
        <Link href={pendingHref as Route} className="text-body-sm">
          <Badge variant="info">{plural(pending, "proposal", "proposals")}</Badge>
        </Link>
      ) : null}
    </div>
  );
  switch (field.kind) {
    case "sourced": {
      const item = isObj(value) ? value : undefined;
      const text = typeof item?.value === "string" ? item.value : "";
      const set = (t: string) => onChange(item ? { ...item, value: t } : sourcedItem(t));
      const words = wordCount(text);
      return (
        <div className="space-y-2">
          {header}
          {item ? <Provenance item={item} /> : null}
          {field.multiline ? (
            <textarea
              id={id}
              rows={4}
              className={controlClass}
              value={text}
              disabled={disabled}
              onChange={(e) => set(e.target.value)}
            />
          ) : (
            <Input id={id} value={text} disabled={disabled} onChange={(e) => set(e.target.value)} />
          )}
          {field.hint ? <p className="text-body-sm text-fg-muted">{field.hint}</p> : null}
          {field.maxWords && text ? (
            <p
              className={
                words > field.maxWords ? "text-body-sm text-warning" : "text-body-sm text-fg-muted"
              }
            >
              {words} words{words > field.maxWords ? `: over ${field.maxWords}` : ""}
            </p>
          ) : null}
        </div>
      );
    }
    case "sourced-object": {
      const item = isObj(value) ? value : sourcedItem({});
      return (
        <fieldset className="space-y-2">
          <legend className="sr-only">{field.label}</legend>
          {header}
          {isObj(value) ? <Provenance item={item} /> : null}
          <ObjectFields
            item={field.item}
            obj={isObj(item.value) ? item.value : {}}
            set={(o) => onChange({ ...item, value: o })}
            sources={sources}
            disabled={disabled}
          />
        </fieldset>
      );
    }
    case "sourced-list":
    case "list":
      return (
        <fieldset className="space-y-2">
          <legend className="sr-only">{field.label}</legend>
          {header}
          {"hint" in field && field.hint ? (
            <p className="text-body-sm text-fg-muted">{field.hint}</p>
          ) : null}
          <ObjectList
            items={Array.isArray(value) ? (value as Obj[]) : []}
            item={field.item}
            withId={"withId" in field ? field.withId : undefined}
            addLabel={field.addLabel}
            onChange={onChange}
            sources={sources}
            disabled={disabled}
            sourced={field.kind === "sourced-list"}
          />
        </fieldset>
      );
    case "lines":
      return (
        <div className="space-y-2">
          {header}
          <LinesInput id={id} value={value} onChange={onChange} disabled={disabled} />
          {field.hint ? <p className="text-body-sm text-fg-muted">{field.hint}</p> : null}
        </div>
      );
    case "object":
      return (
        <fieldset className="space-y-2">
          <legend className="sr-only">{field.label}</legend>
          {header}
          <ObjectFields
            item={field.item}
            obj={isObj(value) ? value : {}}
            set={onChange}
            sources={sources}
            disabled={disabled}
          />
        </fieldset>
      );
  }
}

/**
 * Edits one or more sections of the open draft. Each section is saved whole; the
 * server keeps provenance of unchanged items and validates against the schema.
 */
export function SectionEditor({
  sections,
  initial,
  editable,
  slug,
  clientId,
  versionId,
  rev,
  sources,
  pending,
  proposalsHref,
}: {
  sections: SectionUi[];
  initial: Record<string, unknown>;
  editable: boolean;
  slug: string;
  clientId: string;
  versionId: string | null;
  rev: number;
  sources: SourceOption[];
  /** Pending proposals by JSON Pointer of the field. */
  pending: Record<string, number>;
  proposalsHref: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  // Revisions only grow: another editor on the page (tokens) may have saved since.
  const [savedRev, setRev] = useState(rev);
  const currentRev = Math.max(rev, savedRev);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, start] = useTransition();
  const disabled = !editable || saving;

  const save = () =>
    start(async () => {
      setMessage(null);
      let r = currentRev;
      for (const s of sections) {
        if (!dirty.has(s.section) || !versionId) continue;
        const res = await saveSectionAction({
          slug,
          clientId,
          versionId,
          rev: r,
          section: s.section,
          value: clean(values[s.section]) ?? (s.root === "list" ? [] : {}),
        });
        if (!res.ok) {
          const issue = (
            res.details?.issues as Array<{ path: string; message: string }> | undefined
          )?.[0];
          setMessage({
            kind: "error",
            text: issue ? `${res.error} (${s.title} › ${issue.path})` : res.error,
          });
          return;
        }
        r = res.rev;
      }
      setRev(r);
      setDirty(new Set());
      setMessage({ kind: "ok", text: "Draft saved." });
      router.refresh();
    });

  return (
    <div className="space-y-8">
      {sections.map((s) => {
        const sectionValue = values[s.section];
        const setSection = (next: unknown) => {
          setValues((v) => ({ ...v, [s.section]: next }));
          setDirty((d) => new Set(d).add(s.section));
        };
        return (
          <section
            key={s.section}
            aria-label={s.title}
            className="space-y-6 rounded-lg border border-subtle bg-surface p-6"
          >
            {sections.length > 1 ? <h2 className="text-heading-md text-fg">{s.title}</h2> : null}
            {s.fields.map((f) => {
              const pointer = `/document/${s.section}${f.key ? `/${f.key}` : ""}`;
              const value =
                s.root === "list"
                  ? sectionValue
                  : isObj(sectionValue)
                    ? sectionValue[f.key]
                    : undefined;
              return (
                <Field
                  key={pointer}
                  field={f}
                  value={value}
                  disabled={disabled}
                  sources={sources}
                  pending={Object.entries(pending)
                    .filter(([p]) => p === pointer || p.startsWith(`${pointer}/`))
                    .reduce((a, [, n]) => a + n, 0)}
                  pendingHref={`${proposalsHref}?field=${encodeURIComponent(pointer)}`}
                  onChange={(v) =>
                    setSection(
                      s.root === "list"
                        ? v
                        : { ...(isObj(sectionValue) ? sectionValue : {}), [f.key]: v },
                    )
                  }
                />
              );
            })}
          </section>
        );
      })}
      {editable ? (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-subtle bg-app py-4">
          <Button onClick={save} disabled={saving || dirty.size === 0}>
            <Save aria-hidden />
            {saving ? "Saving…" : "Save draft"}
          </Button>
          {dirty.size ? <span className="text-body-sm text-fg-muted">Unsaved changes</span> : null}
          {message ? (
            <span
              role={message.kind === "error" ? "alert" : "status"}
              className={
                message.kind === "error" ? "text-body-sm text-error" : "text-body-sm text-success"
              }
            >
              {message.text}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
