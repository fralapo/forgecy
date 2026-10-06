"use client";

import { Button, Input, Label } from "@forgecy/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveVersionAction } from "../actions";

/** «Salva versione»: snapshot of the current draft with an optional note. */
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
          setMessage({ error: false, text: `Salvata la versione ${r.number}` });
          router.refresh();
        });
      }}
    >
      <Label htmlFor="cv-note">Nota (facoltativa)</Label>
      <Input
        id="cv-note"
        maxLength={300}
        value={note}
        disabled={disabled || pending}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Es. prima della revisione con il cliente"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={disabled || pending}>
          Salva versione
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
