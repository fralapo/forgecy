"use client";

import { Button, Card, Input, Label } from "@forgecy/ui";
import { ArrowRight, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { addBrandFromUrlAction } from "../actions";

/** One step: a website address (or only a name) creates the brand and opens it, import running. */
export function AddBrand() {
  const t = useTranslations("brand.picker");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const submit = (input: { url: string } | { name: string }) =>
    start(async () => {
      setError(null);
      // On success the action redirects to the new brand, so only a refusal comes back.
      const res = await addBrandFromUrlAction(input);
      if (res && !res.ok) setError(res.error);
    });
  return (
    <Card className="mb-6 grid gap-6 p-6 md:grid-cols-[2fr_1fr]">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit({ url: String(new FormData(e.currentTarget).get("url") ?? "") });
        }}
      >
        <h2 className="text-heading-sm text-fg">{t("addTitle")}</h2>
        <p className="text-body-sm text-fg-muted">{t("addDescription")}</p>
        <Label htmlFor="add-brand-url">{t("urlLabel")}</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="add-brand-url"
            name="url"
            type="url"
            required
            placeholder={t("urlPlaceholder")}
            className="min-w-64 flex-1"
          />
          <Button type="submit" disabled={pending}>
            <Sparkles aria-hidden />
            {pending ? t("analyzing") : t("analyze")}
          </Button>
        </div>
      </form>
      <form
        className="space-y-3 border-subtle md:border-l md:pl-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit({ name: String(new FormData(e.currentTarget).get("name") ?? "") });
        }}
      >
        <h2 className="text-heading-sm text-fg">{t("nameTitle")}</h2>
        <p className="text-body-sm text-fg-muted">{t("nameDescription")}</p>
        <Label htmlFor="add-brand-name">{t("nameLabel")}</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="add-brand-name"
            name="name"
            required
            maxLength={120}
            placeholder={t("namePlaceholder")}
            className="min-w-40 flex-1"
          />
          <Button type="submit" variant="secondary" disabled={pending}>
            {t("continue")}
            <ArrowRight aria-hidden />
          </Button>
        </div>
      </form>
      {error ? (
        <p role="alert" className="text-body-sm text-error md:col-span-2">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
