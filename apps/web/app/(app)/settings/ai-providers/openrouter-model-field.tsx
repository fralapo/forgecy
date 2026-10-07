"use client";

import { Input } from "@forgecy/ui";
import { useEffect, useState } from "react";

interface OpenRouterModelOption {
  id: string;
  name: string;
  created: number;
}

/** Shared across every field on the page so the catalog is fetched once, not per field. */
let catalog: Promise<OpenRouterModelOption[]> | undefined;
function loadCatalog(): Promise<OpenRouterModelOption[]> {
  catalog ??= fetch("/api/ai/openrouter-models")
    .then((res) => (res.ok ? res.json() : { models: [] }))
    .then((json: { models?: OpenRouterModelOption[] }) => json.models ?? [])
    .catch(() => []);
  return catalog;
}

/**
 * A model id field backed by OpenRouter's live catalog: type to search (native
 * datalist, substring match), or paste any id — nothing is enforced, so a model
 * OpenRouter adds after this page last loaded still works.
 */
export function OpenRouterModelField({
  id,
  name,
  defaultValue,
  placeholder,
}: {
  id: string;
  name: string;
  defaultValue: string;
  placeholder: string;
}) {
  const listId = `${id}-models`;
  const [options, setOptions] = useState<OpenRouterModelOption[]>([]);
  useEffect(() => {
    let active = true;
    loadCatalog().then((models) => {
      if (active) setOptions(models);
    });
    return () => {
      active = false;
    };
  }, []);
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
