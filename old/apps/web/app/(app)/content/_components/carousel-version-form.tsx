"use client";

import { Button, Input, Label } from "@forgecy/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { saveVersionAction } from "../actions";

/** “Save version”: snapshot of the current draft with an optional note. */
export function CarouselVersionForm({
  slug,
  clientId,
  contentId,
  draftRev,
  disabled,
}: {
  slug: string;
  clientId: string;
  contentId: string;
  draftRev: number;
  disabled: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("content.versions.form");
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        start(async () => {
          const r = await saveVersionAction({
            slug,
            clientId,
            id: contentId,
            draftRev,
            ...(note.trim() ? { note: note.trim() } : {}),
          });
          if (!r.ok) return setMessage({ error: true, text: r.error });
          setNote("");
          setMessage({ error: false, text: t("saved", { number: r.number }) });
          router.refresh();
        });
      }}
    >
      <Label htmlFor="cv-note">{t("note")}</Label>
      <Input
        id="cv-note"
        maxLength={300}
        value={note}
        disabled={disabled || pending}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t("notePlaceholder")}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={disabled || pending}>
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
