"use client";

import {
  brandSystemPartFiles,
  brandSystemParts,
  type BrandSystemPart,
} from "@forgecy/brand-book/client";
import { Button, Label } from "@forgecy/ui";
import { FileArchive } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { exportBrandSystemAction } from "../actions";
import { controlClass } from "./section-editor";

/** Choose the version and the files, then build the Internal Brand System ZIP. */
export function BrandSystemForm({
  slug,
  clientId,
  versions,
}: {
  slug: string;
  clientId: string;
  versions: Array<{ id: string; label: string }>;
}) {
  const t = useTranslations("brand.book");
  const router = useRouter();
  const [versionId, setVersionId] = useState(versions[0]?.id ?? "");
  const [parts, setParts] = useState<Set<BrandSystemPart>>(new Set(brandSystemParts));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setDone(null);
        start(async () => {
          const r = await exportBrandSystemAction({
            slug,
            clientId,
            versionId,
            parts: [...parts],
          });
          if (!r.ok) setError(r.error);
          else {
            setDone(r.number);
            router.refresh();
          }
        });
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="bs-version">{t("version")}</Label>
        <select
          id="bs-version"
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
      <fieldset className="space-y-2">
        <legend className="text-heading-sm text-fg">{t("files")}</legend>
        <p className="text-body-sm text-fg-muted">{t("filesHint")}</p>
        <ul className="space-y-2">
          {brandSystemParts.map((p) => (
            <li key={p} className="flex items-start gap-3 text-body-sm">
              <input
                id={`bs-${p}`}
                type="checkbox"
                className="mt-1 size-4"
                checked={parts.has(p)}
                onChange={(e) =>
                  setParts((s) => {
                    const next = new Set(s);
                    if (e.target.checked) next.add(p);
                    else next.delete(p);
                    return next;
                  })
                }
              />
              <label htmlFor={`bs-${p}`} className="text-fg">
                {t(`parts.${p}`)}
                <span className="block font-mono text-fg-muted">
                  {brandSystemPartFiles[p].join(" · ")}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || !versionId || parts.size === 0}>
          <FileArchive aria-hidden className="size-4" />
          {pending ? t("generating") : t("generate")}
        </Button>
        {done !== null ? (
          <span role="status" className="text-body-sm text-success">
            {t("generated", { number: done })}
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
