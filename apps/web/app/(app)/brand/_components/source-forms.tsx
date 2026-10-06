"use client";

import { Button, Input, Label } from "@forgecy/ui";
import { FileUp, Link2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { addLinkSourceAction } from "../actions";
import { controlClass } from "./section-editor";

const fileKinds = [
  "brand_book",
  "document",
  "screenshot",
  "questionnaire",
  "interview",
  "client_approval",
] as const;
const linkKinds = [
  "website",
  "instagram",
  "facebook",
  "linkedin",
  "tiktok",
  "competitor",
  "manual",
  "internal_feedback",
  "interview",
] as const;

export function UploadSourceForm({ slug, open }: { slug: string; open?: boolean }) {
  const t = useTranslations("brand.sources.upload");
  const tk = useTranslations("brand.sourceKind");
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  return (
    <form
      ref={ref}
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        start(async () => {
          setMessage(null);
          const res = await fetch(`/brand/${slug}/sources/upload`, { method: "POST", body: data });
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          if (!res.ok) return setMessage({ kind: "error", text: body.message ?? t("failed") });
          ref.current?.reset();
          setMessage({ kind: "ok", text: t("done") });
          router.refresh();
        });
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="import-file">{t("file")}</Label>
        <input
          id="import-file"
          name="file"
          type="file"
          required
          autoFocus={open}
          accept=".pdf,.pptx,.docx,.png,.jpg,.jpeg,.webp,.gif,.svg,.ttf,.otf,.woff,.woff2,.txt,.md"
          className={controlClass}
        />
        <p className="text-body-sm text-fg-muted">{t("fileHint")}</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="import-kind">{t("type")}</Label>
        <select id="import-kind" name="kind" className={controlClass} defaultValue="brand_book">
          {fileKinds.map((k) => (
            <option key={k} value={k}>
              {tk(k)}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="import-title">{t("title")}</Label>
        <Input id="import-title" name="title" placeholder={t("titlePlaceholder")} />
      </div>
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
      <Button type="submit" disabled={pending}>
        <FileUp aria-hidden />
        {pending ? t("uploading") : t("submit")}
      </Button>
    </form>
  );
}

export function LinkSourceForm({ slug, clientId }: { slug: string; clientId: string }) {
  const t = useTranslations("brand.sources.link");
  const tk = useTranslations("brand.sourceKind");
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  return (
    <form
      ref={ref}
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        start(async () => {
          const res = await addLinkSourceAction({
            slug,
            clientId,
            kind: String(f.get("kind")),
            title: String(f.get("title") ?? ""),
            url: String(f.get("url") ?? ""),
            note: String(f.get("note") ?? ""),
          });
          if (!res.ok) return setMessage({ kind: "error", text: res.error });
          ref.current?.reset();
          setMessage({ kind: "ok", text: t("added") });
          router.refresh();
        });
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="link-kind">{t("type")}</Label>
        <select id="link-kind" name="kind" className={controlClass} defaultValue="website">
          {linkKinds.map((k) => (
            <option key={k} value={k}>
              {tk(k)}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="link-title">{t("title")}</Label>
        <Input id="link-title" name="title" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="link-url">{t("url")}</Label>
        <Input id="link-url" name="url" type="url" placeholder={t("urlPlaceholder")} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="link-note">{t("note")}</Label>
        <textarea id="link-note" name="note" rows={4} className={controlClass} />
        <p className="text-body-sm text-fg-muted">{t("noteHint")}</p>
      </div>
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
      <Button type="submit" variant="secondary" disabled={pending}>
        <Link2 aria-hidden />
        {t("submit")}
      </Button>
    </form>
  );
}
