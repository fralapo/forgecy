"use client";

import { bookSections, type BookSection } from "@forgecy/brand-book/client";
import type { Locale } from "@forgecy/core";
import { Button, Label } from "@forgecy/ui";
import { FileText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { createClientBookAction } from "../actions";
import { controlClass } from "./section-editor";

/** Brand Identity page where each section's content is edited. */
const sectionPage: Record<BookSection, string> = {
  strategy: "strategy",
  verbal: "verbal",
  visual: "visual",
  content: "content",
  dos: "visual",
};

/** Choose the version, the language and the sections, then queue the draft preview. */
export function ClientBookForm({
  slug,
  clientId,
  versions,
  languages,
  defaultLanguage,
}: {
  slug: string;
  clientId: string;
  versions: Array<{ id: string; label: string; empty: BookSection[] }>;
  languages: Locale[];
  defaultLanguage: Locale;
}) {
  const t = useTranslations("brand.book");
  const router = useRouter();
  const [versionId, setVersionId] = useState(versions[0]?.id ?? "");
  const [language, setLanguage] = useState<Locale>(defaultLanguage);
  const [chosen, setChosen] = useState<Set<BookSection>>(new Set(bookSections));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const empty = new Set(versions.find((v) => v.id === versionId)?.empty ?? []);
  const sections = bookSections.filter((s) => chosen.has(s) && !empty.has(s));

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setDone(null);
        start(async () => {
          const r = await createClientBookAction({ slug, clientId, versionId, sections, language });
          if (!r.ok) setError(r.error);
          else {
            setDone(r.number);
            router.refresh();
          }
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="cb-version">{t("version")}</Label>
          <select
            id="cb-version"
            className={controlClass}
            value={versionId}
            onChange={(e) => setVersionId(e.target.value)}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cb-language">{t("language")}</Label>
          <select
            id="cb-language"
            className={controlClass}
            value={language}
            onChange={(e) => setLanguage(e.target.value as Locale)}
          >
            {languages.map((l) => (
              <option key={l} value={l}>
                {t(`languages.${l}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-heading-sm text-fg">{t("sections")}</legend>
        <ul className="space-y-2">
          {bookSections.map((s) => {
            const isEmpty = empty.has(s);
            return (
              <li key={s} className="flex items-start gap-3 text-body-sm">
                <input
                  id={`cb-${s}`}
                  type="checkbox"
                  className="mt-1 size-4"
                  disabled={isEmpty}
                  checked={!isEmpty && chosen.has(s)}
                  aria-describedby={isEmpty ? `cb-${s}-empty` : undefined}
                  onChange={(e) =>
                    setChosen((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(s);
                      else next.delete(s);
                      return next;
                    })
                  }
                />
                <label htmlFor={`cb-${s}`} className={isEmpty ? "text-fg-muted" : "text-fg"}>
                  {t(`sectionNames.${s}`)}
                  {isEmpty ? (
                    <span id={`cb-${s}-empty`} className="block text-fg-muted">
                      {t.rich("sectionEmpty", {
                        link: (chunks) => (
                          <Link href={`/brand/${slug}/${sectionPage[s]}`}>{chunks}</Link>
                        ),
                      })}
                    </span>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || !versionId || sections.length === 0}>
          <FileText aria-hidden className="size-4" />
          {t("generatePreview")}
        </Button>
        {done !== null ? (
          <span role="status" className="text-body-sm text-success">
            {t("previewQueued", { number: done })}
          </span>
        ) : null}
        {error ? (
          <span role="alert" className="text-body-sm text-error">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
