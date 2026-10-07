"use client";

import { Input } from "@forgecy/ui";
import { useEffect, useState } from "react";

export type CatalogProvider = "openai" | "anthropic" | "openrouter" | "deepseek";
/** "text" lists chat/completion models; "image" lists only image-generation models. */
export type CatalogKind = "text" | "image";

interface ModelOption {
  id: string;
  name: string;
  created: number;
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
 * A model id field backed by a provider's live catalog: type to search (native
 * datalist, substring match), or paste any id — nothing is enforced, so a model the
 * provider adds after this page last loaded still works. OpenRouter's list needs no
 * key; the other three use whichever key (pasted or env) is actually configured, and
 * fall back to no suggestions (still a plain text field) when none is. `kind` keeps
 * image-generation models out of a text field and chat models out of an image field.
 */
export function LiveModelField({
  provider,
  kind,
  id,
  name,
  defaultValue,
  placeholder,
}: {
  provider: CatalogProvider;
  kind: CatalogKind;
  id: string;
  name: string;
  defaultValue: string;
  placeholder: string;
}) {
  const listId = `${id}-models`;
  const [options, setOptions] = useState<ModelOption[]>([]);
  useEffect(() => {
    let active = true;
    loadCatalog(provider, kind).then((models) => {
      if (active) setOptions(models);
    });
    return () => {
      active = false;
    };
  }, [provider, kind]);
  return (
    <>
      <Input
        id={id}
        name={name}
        list={listId}
        defaultValue={defaultValue}
        placeholder={placeholder}
        maxLength={200}
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map((m) => (
          <option key={m.id} value={m.id} label={m.name} />
        ))}
      </datalist>
    </>
  );
}
