"use client";

import { Button } from "@forgecy/ui";
import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { exportAction } from "../actions";

type Output = "png" | "pdf" | "zip";
const OUTPUTS: Output[] = ["png", "pdf", "zip"];

/** Export request: draft (watermarked, any time) or final (approved version only). */
export function CarouselExportForm({
  slug,
  clientId,
  contentId,
  canFinal,
  approvedVersion,
  disabled,
}: {
  slug: string;
  clientId: string;
  contentId: string;
  canFinal: boolean;
  approvedVersion: number | null;
  disabled: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("content.export.form");
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState(!canFinal);
  const [outputs, setOutputs] = useState<Output[]>(["zip"]);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        start(async () => {
          const r = await exportAction({ slug, clientId, id: contentId, draft, outputs });
          if (!r.ok)
            return setMessage({
              error: true,
              text: r.code === "EXPORT-NOT-APPROVED" ? t("notApproved") : r.error,
            });
          setMessage({ error: false, text: t("queued") });
          router.refresh();
        });
      }}
    >
      <fieldset disabled={disabled || pending} className="grid gap-4">
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-label text-fg">{t("version")}</legend>
          <label className="flex items-center gap-2 text-body-sm text-fg">
            <input type="radio" name="ex-kind" checked={draft} onChange={() => setDraft(true)} />
            {t("draft")}
          </label>
          <label className="flex items-center gap-2 text-body-sm text-fg">
            <input
              type="radio"
              name="ex-kind"
              checked={!draft}
              disabled={!canFinal}
              onChange={() => setDraft(false)}
            />
            {approvedVersion ? t("finalVersion", { number: approvedVersion }) : t("final")}
          </label>
          {!canFinal ? <p className="text-body-sm text-fg-muted">{t("finalHint")}</p> : null}
        </fieldset>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-label text-fg">{t("file")}</legend>
          {OUTPUTS.map((o) => (
            <label key={o} className="flex items-center gap-2 text-body-sm text-fg">
              <input
                type="checkbox"
                checked={outputs.includes(o)}
                onChange={(e) =>
                  setOutputs((cur) => (e.target.checked ? [...cur, o] : cur.filter((x) => x !== o)))
                }
              />
              {t(`outputs.${o}`)}
            </label>
          ))}
        </fieldset>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={disabled || pending || outputs.length === 0}>
          <Download aria-hidden />
          {t("submit")}
        </Button>
        {message ? (
          <span
            role={message.error ? "alert" : "status"}
            className={message.error ? "text-body-sm text-error" : "text-body-sm text-fg-muted"}
          >
            {message.text}
          </span>
        ) : null}
      </div>
    </form>
  );
}
