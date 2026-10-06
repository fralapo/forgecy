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
  const action = `/content/${slug}/library/upload`;
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
                body.message ?? (res.status === 413 ? "The file exceeds 15 MB." : "Upload failed."),
            });
          ref.current?.reset();
          setMessage({
            kind: "ok",
            text: body.created
              ? "Image uploaded and ready to use."
              : "This image was already in the library.",
          });
          router.refresh();
        });
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="library-file">Image</Label>
        <input
          id="library-file"
          name="file"
          type="file"
          required
          accept="image/png,image/jpeg,image/webp"
          className={controlClass}
        />
        <p className="text-body-sm text-fg-muted">PNG, JPEG or WebP up to 15 MB.</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="library-alt">Alt text</Label>
        <Input id="library-alt" name="alt" maxLength={300} placeholder="What the image shows" />
      </div>
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <Button type="submit" disabled={pending}>
          <ImageUp aria-hidden />
          {pending ? "Uploading…" : "Upload image"}
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
