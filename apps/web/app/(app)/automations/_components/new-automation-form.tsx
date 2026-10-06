"use client";

import { automationSources, type AutomationSource } from "@forgecy/core";
import { Button, Input, Label } from "@forgecy/ui";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { controlClass } from "../../content/_components/action-button";
import { createAutomationAction } from "../actions";

/** “New automation” (page 58): client, name and origin; the rest is set on page 59. */
export function NewAutomationForm({
  clients,
  dateLabel,
}: {
  clients: { id: string; name: string }[];
  dateLabel: string;
}) {
  const t = useTranslations("automations.new");
  const ts = useTranslations("automations.source");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const defaultName = (id: string) =>
    t("nameDefault", { date: dateLabel, client: clients.find((c) => c.id === id)?.name ?? "" });
  const [name, setName] = useState(defaultName(clients[0]?.id ?? ""));
  const [source, setSource] = useState<AutomationSource>("briefs");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open)
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus aria-hidden className="size-4" />
        {t("open")}
      </Button>
    );

  return (
    <form
      aria-labelledby="na-heading"
      className="grid w-full max-w-xl gap-4 rounded-lg border border-subtle bg-surface p-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await createAutomationAction({ clientId, name, source });
          if (!r.ok) setError(r.error);
          else router.push(`/automations/${r.id}`);
        });
      }}
    >
      <h2 id="na-heading" className="text-heading-sm text-fg">
        {t("heading")}
      </h2>
      {clients.length === 0 ? (
        <p className="text-body-sm text-fg-muted">
          {t.rich("noEligible", { link: (c) => <Link href="/clients">{c}</Link> })}
        </p>
      ) : (
        <fieldset disabled={pending} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="na-client">{t("client")}</Label>
            <select
              id="na-client"
              className={controlClass}
              value={clientId}
              onChange={(e) => {
                // Keep a name the person typed; refresh the suggested one.
                if (name === defaultName(clientId)) setName(defaultName(e.target.value));
                setClientId(e.target.value);
              }}
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="na-name">{t("name")}</Label>
            <Input
              id="na-name"
              value={name}
              maxLength={120}
              required
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-label text-fg">{t("source")}</legend>
            {automationSources.map((s) => (
              <label key={s} className="flex items-center gap-2 text-body-sm text-fg">
                <input
                  type="radio"
                  name="na-source"
                  value={s}
                  checked={source === s}
                  onChange={() => setSource(s)}
                />
                {ts(s)}
              </label>
            ))}
          </fieldset>
        </fieldset>
      )}
      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        {clients.length ? (
          <Button type="submit" disabled={pending || !name.trim()}>
            {t("create")}
          </Button>
        ) : null}
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
