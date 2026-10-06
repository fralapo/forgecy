"use client";

import { Button, Input, Label } from "@forgecy/ui";
import { ImageUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { controlClass } from "./action-button";

/** Upload of a PNG, JPEG or WebP into the client's library (route handler, not an action). */
export function LibraryUploadForm({ slug }: { slug: string }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const action = `/contenuti/${slug}/libreria/upload`;
  return (
    <form
      ref={ref}
      action={action}
      method="post"
      encType="multipart/form-data"
      className="grid gap-4 md:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        start(async () => {
          setMessage(null);
          const res = await fetch(action, {
            method: "POST",
            body: data,
            headers: { accept: "application/json" },
          });
          const body = (await res.json().catch(() => ({}))) as {
            message?: string;
            created?: boolean;
          };
          if (!res.ok)
            return setMessage({
              kind: "error",
              text:
                body.message ??
                (res.status === 413 ? "Il file supera i 15 MB." : "Caricamento non riuscito."),
            });
          ref.current?.reset();
          setMessage({
            kind: "ok",
            text: body.created
              ? "Immagine caricata e già utilizzabile."
              : "Questa immagine era già in libreria.",
          });
          router.refresh();
        });
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="library-file">Immagine</Label>
        <input
          id="library-file"
          name="file"
          type="file"
          required
          accept="image/png,image/jpeg,image/webp"
          className={controlClass}
        />
        <p className="text-body-sm text-fg-muted">PNG, JPEG o WebP fino a 15 MB.</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="library-alt">Testo alternativo</Label>
        <Input id="library-alt" name="alt" maxLength={300} placeholder="Cosa mostra l'immagine" />
      </div>
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <Button type="submit" disabled={pending}>
          <ImageUp aria-hidden />
          {pending ? "Caricamento…" : "Carica immagine"}
        </Button>
        {message ? (
          <p
            role={message.kind === "error" ? "alert" : "status"}
            className={
              message.kind === "error" ? "text-body-sm text-error" : "text-body-sm text-success"
            }
          >
            {message.text}
          </p>
        ) : null}
      </div>
    </form>
  );
}
