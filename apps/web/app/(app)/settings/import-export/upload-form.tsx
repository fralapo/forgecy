"use client";

import { Button, Label } from "@forgecy/ui";
import { Upload } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { controlClass } from "../../content/_components/action-button";

/** Step File: sends the ZIP as the request body, with progress, then opens the import. */
export function UploadForm({ maxLabel }: { maxLabel: string }) {
  const t = useTranslations("clientTransfer.import.file");
  const te = useTranslations("clientTransfer.errors");
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = () => {
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) return setError(te("notZip"));
    setError(null);
    setPercent(0);
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/settings/import-export/upload?name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader("Content-Type", "application/zip");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setPercent(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => {
      setPercent(null);
      setError(te("uploadFailed"));
    };
    xhr.onload = () => {
      let body: { id?: string; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText) as typeof body;
      } catch {
        // A server error page: shown as a failed upload.
      }
      if (xhr.status === 200 && body.id) {
        router.push(`/settings/import-export?tab=import&importId=${body.id}` as Route);
        return;
      }
      setPercent(null);
      setError(body.error ?? te("uploadFailed"));
    };
    xhr.send(file);
  };

  const busy = percent !== null;
  return (
    <div className="grid gap-4">
      <div>
        <h3 className="text-heading-sm text-fg">{t("title")}</h3>
        <p id="ie-file-hint" className="mt-1 text-body-sm text-fg-muted">
          {t("hint", { size: maxLabel })}
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="ie-file">{t("label")}</Label>
        <input
          id="ie-file"
          type="file"
          accept=".zip,application/zip"
          aria-describedby="ie-file-hint"
          disabled={busy}
          className={controlClass}
          onChange={(e) => {
            setError(null);
            setFile(e.target.files?.[0] ?? null);
          }}
        />
      </div>
      {busy ? (
        <div className="grid gap-1" aria-live="polite">
          <progress value={percent} max={100} className="h-2 w-full accent-primary" />
          <p className="text-body-sm text-fg-muted">{t("uploading", { percent })}</p>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
      <Button type="button" className="w-fit" disabled={!file || busy} onClick={send}>
        <Upload aria-hidden className="size-4" />
        {t("submit")}
      </Button>
    </div>
  );
}
