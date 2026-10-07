"use client";

import { Input } from "@forgecy/ui";
import { useEffect, useState } from "react";

export type CatalogProvider = "openai" | "anthropic" | "openrouter" | "deepseek";

interface ModelOption {
  id: string;
  name: string;
  created: number;
}

/** One cache entry per provider, shared across every field on the page. */
const catalogs = new Map<CatalogProvider, Promise<ModelOption[]>>();
function loadCatalog(provider: CatalogProvider): Promise<ModelOption[]> {
  let p = catalogs.get(provider);
  if (!p) {
    p = fetch(`/api/ai/models?provider=${provider}`)
      .then((res) => (res.ok ? res.json() : { models: [] }))
      .then((json: { models?: ModelOption[] }) => json.models ?? [])
      .catch(() => []);
    catalogs.set(provider, p);
  }
  return p;
}

/**
 * A model id field backed by a provider's live catalog: type to search (native
 * datalist, substring match), or paste any id — nothing is enforced, so a model the
 * provider adds after this page last loaded still works. OpenRouter's list needs no
 * key; the other three use whichever key (pasted or env) is actually configured, and
 * fall back to no suggestions (still a plain text field) when none is.
 */
export function LiveModelField({
  provider,
  id,
  name,
  defaultValue,
  placeholder,
}: {
  provider: CatalogProvider;
  id: string;
  name: string;
  defaultValue: string;
  placeholder: string;
}) {
  const listId = `${id}-models`;
  const [options, setOptions] = useState<ModelOption[]>([]);
  useEffect(() => {
    let active = true;
    loadCatalog(provider).then((models) => {
      if (active) setOptions(models);
    });
    return () => {
      active = false;
    };
  }, [provider]);
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
