"use client";

import { Input } from "@forgecy/ui";
import { ChevronDown, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

export type CatalogProvider = "openai" | "anthropic" | "openrouter" | "deepseek";
/** "text" lists chat/completion models; "image" lists only image-generation models. */
export type CatalogKind = "text" | "image";

interface ModelOption {
  id: string;
  name: string;
  created: number;
}

/** `key` is the (provider, kind) this result is for, so a stale result never masks a fresh load. */
interface CatalogState {
  key: string;
  models: ModelOption[] | null;
}

/** One cache entry per (provider, kind) pair, shared across every field on the page. */
const catalogs = new Map<string, Promise<ModelOption[]>>();
function loadCatalog(provider: CatalogProvider, kind: CatalogKind): Promise<ModelOption[]> {
  const cacheKey = `${provider}:${kind}`;
  let p = catalogs.get(cacheKey);
  if (!p) {
    p = fetch(`/api/ai/models?provider=${provider}&kind=${kind}`)
      .then((res) => (res.ok ? res.json() : { models: [] }))
      .then((json: { models?: ModelOption[] }) => json.models ?? [])
      .catch(() => []);
    catalogs.set(cacheKey, p);
  }
  return p;
}

/**
 * A model id field backed by a provider's live catalog: a visible dropdown of matching
 * models opens on focus and narrows as you type (substring match on id or name), or
 * paste any id — nothing is enforced, so a model the provider adds after this page last
 * loaded still works. OpenRouter's list needs no key; the other three use whichever key
 * (pasted or env) is actually configured. `ready=false` means this provider has no key
 * configured right now, so the catalog fetch will come back empty — the dropdown says so
 * instead of just looking stuck. `kind` keeps image-generation models out of a text field
 * and chat models out of an image field.
 */
export function LiveModelField({
  provider,
  kind,
  ready,
  id,
  name,
  defaultValue,
  placeholder,
}: {
  provider: CatalogProvider;
  kind: CatalogKind;
  ready: boolean;
  id: string;
  name: string;
  defaultValue: string;
  placeholder: string;
}) {
  const t = useTranslations("settings.aiProviders.routing");
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const cacheKey = `${provider}:${kind}`;
  const [catalog, setCatalog] = useState<CatalogState>({ key: cacheKey, models: null });
  const containerRef = useRef<HTMLDivElement>(null);
  // Stale while `catalog` still holds a previous (provider, kind)'s result or hasn't loaded yet.
  const loading = catalog.key !== cacheKey || catalog.models === null;

  useEffect(() => {
    let active = true;
    loadCatalog(provider, kind).then((models) => {
      if (active) setCatalog({ key: cacheKey, models });
    });
    return () => {
      active = false;
    };
  }, [provider, kind, cacheKey]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const matches = useMemo(() => {
    if (loading || !catalog.models) return [];
    const q = value.trim().toLowerCase();
    const all = catalog.models;
    const filtered = q
      ? all.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      : all;
    return filtered.slice(0, 50);
  }, [catalog, loading, value]);

  function select(modelId: string) {
    setValue(modelId);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlighted((h) => Math.min(h + 1, matches.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === "Enter" && open && matches[highlighted]) {
      e.preventDefault();
      select(matches[highlighted].id);
    }
  }

  const listboxId = `${id}-listbox`;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Input
          id={id}
          name={name}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setHighlighted(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          maxLength={200}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          className="pr-9"
        />
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-fg-muted">
          {loading ? (
            <Loader2 aria-hidden className="size-4 animate-spin" />
          ) : (
            <ChevronDown aria-hidden className="size-4" />
          )}
        </span>
      </div>
      {open ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-subtle bg-surface py-1 shadow-dropdown"
        >
          {loading ? (
            <p className="px-3 py-2 text-body-sm text-fg-muted">{t("catalogLoading")}</p>
          ) : !ready && matches.length === 0 ? (
            <p className="px-3 py-2 text-body-sm text-fg-muted">{t("catalogNoKey")}</p>
          ) : matches.length === 0 ? (
            <p className="px-3 py-2 text-body-sm text-fg-muted">
              {value.trim() ? t("catalogEmpty", { query: value.trim() }) : t("catalogNoKey")}
            </p>
          ) : (
            matches.map((m, i) => (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={i === highlighted}
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(m.id);
                }}
                onMouseEnter={() => setHighlighted(i)}
                className={`flex w-full flex-col items-start gap-0 px-3 py-1.5 text-left text-body-sm ${
                  i === highlighted ? "bg-app" : ""
                }`}
              >
                <span className="text-fg">{m.name}</span>
                {m.name !== m.id ? (
                  <span className="font-mono text-body-sm text-fg-muted">{m.id}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
