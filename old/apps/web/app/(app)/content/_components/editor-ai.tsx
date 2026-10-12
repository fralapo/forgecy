"use client";

import { Badge, Button, Label } from "@forgecy/ui";
import { Check, ImageOff, Sparkles, Undo2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  decideAssetAction,
  decideSlideEditAction,
  generateImageAction,
  requestSlideEditAction,
} from "../actions";
import { useFormat } from "@/lib/use-format";
import { ActionButton, controlClass } from "./action-button";
import {
  useActionMessage,
  type EditorAsset,
  type EditorEdit,
  type EditorRef,
} from "./editor-workspace";

const editVariant: Record<
  EditorEdit["status"],
  "neutral" | "info" | "success" | "warning" | "error"
> = {
  queued: "info",
  applied: "warning",
  kept: "success",
  reverted: "neutral",
  failed: "error",
};

export function Thumb({ url, alt }: { url: string | null; alt: string }) {
  const t = useTranslations("content.editor.ai");
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL
    <img
      src={url}
      alt={alt}
      loading="lazy"
      className="aspect-square w-full rounded-md border border-subtle bg-app object-contain"
    />
  ) : (
    <div className="flex aspect-square w-full items-center justify-center rounded-md border border-dashed border-subtle text-fg-muted">
      <ImageOff aria-hidden />
      <span className="sr-only">{t("previewUnavailable")}</span>
    </div>
  );
}

/** “Ask the AI” on one slide, and the AI edits waiting for “Keep” or “Undo edit”. */
export function SlideAiPanel({
  editorRef: r,
  slideId,
  edits,
  disabled,
  flush,
}: {
  editorRef: EditorRef;
  slideId: string;
  edits: EditorEdit[];
  disabled: boolean;
  flush: () => Promise<boolean>;
}) {
  const router = useRouter();
  const t = useTranslations("content.editor.ai");
  const format = useFormat();
  const actionMessage = useActionMessage();
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const base = { slug: r.slug, clientId: r.clientId, id: r.contentId };
  const open = edits.filter((e) => e.status === "queued" || e.status === "applied");
  const past = edits.filter((e) => e.status !== "queued" && e.status !== "applied").slice(0, 5);
  const valid = instruction.trim().length >= 3 && instruction.trim().length <= 500;

  return (
    <section
      aria-labelledby={`ai-${slideId}`}
      className="space-y-3 rounded-lg border border-subtle bg-surface p-4"
    >
      <h2 id={`ai-${slideId}`} className="flex items-center gap-2 text-heading-sm text-fg">
        <Sparkles aria-hidden className="size-5" />
        {t("ask")}
      </h2>
      <p className="text-body-sm text-fg-muted">{t("askIntro")}</p>
      <div className="space-y-1">
        <Label htmlFor={`ai-instruction-${slideId}`}>{t("instruction")}</Label>
        <textarea
          id={`ai-instruction-${slideId}`}
          rows={2}
          maxLength={500}
          className={controlClass}
          value={instruction}
          disabled={disabled || pending}
          placeholder={t("instructionPlaceholder")}
          onChange={(e) => setInstruction(e.target.value)}
        />
      </div>
      <Button
        variant="secondary"
        disabled={disabled || pending || !valid}
        onClick={() =>
          start(async () => {
            setError(null);
            if (!(await flush())) return setError(t("saveFirst"));
            const res = await requestSlideEditAction({ ...base, slideId, instruction });
            if (!res.ok) return setError(actionMessage(res));
            setInstruction("");
            router.refresh();
          })
        }
      >
        <Sparkles aria-hidden />
        {t("ask")}
      </Button>
      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}

      {open.length ? (
        <ul className="space-y-3">
          {open.map((e) => (
            <li key={e.id} className="space-y-2 rounded-md border border-control p-3">
              <p className="flex flex-wrap items-center gap-2 text-body-sm text-fg">
                <Badge variant={editVariant[e.status]}>{t(`editStatus.${e.status}`)}</Badge>
                {t("quoted", { text: e.instruction })}
              </p>
              {e.note ? <p className="text-body-sm text-fg-muted">{e.note}</p> : null}
              {e.status === "applied" ? (
                <div className="flex flex-wrap gap-2">
                  <ActionButton
                    size="sm"
                    action={() =>
                      decideSlideEditAction({ ...base, editId: e.id, decision: "keep" })
                    }
                  >
                    <Check aria-hidden />
                    {t("keep")}
                  </ActionButton>
                  <ActionButton
                    size="sm"
                    variant="secondary"
                    action={async () => {
                      if (!(await flush())) return { ok: false, error: t("saveFirst") };
                      return decideSlideEditAction({ ...base, editId: e.id, decision: "revert" });
                    }}
                  >
                    <Undo2 aria-hidden />
                    {t("undo")}
                  </ActionButton>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {past.length ? (
        <details className="text-body-sm">
          <summary className="cursor-pointer text-fg-muted">{t("previous")}</summary>
          <ul className="mt-2 space-y-1">
            {past.map((e) => (
              <li key={e.id} className="text-fg">
                <Badge variant={editVariant[e.status]}>{t(`editStatus.${e.status}`)}</Badge>{" "}
                {t("quoted", { text: e.instruction })} · {format.date(e.createdAt, "dateTime")}
                {e.status === "failed" && e.note ? (
                  <span className="block text-error">{e.note}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/** “Generate with AI” for an image slot: brief and number of variants, then a job. */
export function ImageGenerator({
  editorRef: r,
  slideId,
  slot,
  flush,
}: {
  editorRef: EditorRef;
  slideId: string;
  slot: string;
  flush: () => Promise<boolean>;
}) {
  const router = useRouter();
  const t = useTranslations("content.editor.image");
  const actionMessage = useActionMessage();
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [variants, setVariants] = useState(2);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const id = `gen-${slideId}-${slot}`;

  if (!open)
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Sparkles aria-hidden />
        {t("open")}
      </Button>
    );
  return (
    <div
      role="group"
      aria-labelledby={`${id}-title`}
      className="space-y-3 rounded-md border border-control p-3"
    >
      <p id={`${id}-title`} className="text-body-sm font-medium text-fg">
        {t("title")}
      </p>
      <div className="space-y-1">
        <Label htmlFor={`${id}-brief`}>{t("brief")}</Label>
        <textarea
          id={`${id}-brief`}
          rows={3}
          maxLength={1000}
          className={controlClass}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder={t("briefPlaceholder")}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-variants`}>{t("variants")}</Label>
        <select
          id={`${id}-variants`}
          className={`${controlClass} w-24`}
          value={variants}
          onChange={(e) => setVariants(Number(e.target.value))}
        >
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <p className="text-body-sm text-fg-muted">{t("hint")}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={pending || brief.trim().length < 3}
          onClick={() =>
            start(async () => {
              setMessage(null);
              if (!(await flush())) return setMessage({ ok: false, text: t("saveFirst") });
              const res = await generateImageAction({
                slug: r.slug,
                clientId: r.clientId,
                id: r.contentId,
                slideId,
                slot,
                brief: brief.trim(),
                variants,
              });
              if (!res.ok) return setMessage({ ok: false, text: actionMessage(res) });
              setMessage({ ok: true, text: t("started") });
              setBrief("");
              router.refresh();
            })
          }
        >
          <Sparkles aria-hidden />
          {t("generate")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          {t("close")}
        </Button>
      </div>
      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? "text-body-sm text-success" : "text-body-sm text-error"}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

/** AI images generated for this slot and still to approve: use, approve or reject. */
export function AiImageDrafts({
  editorRef: r,
  drafts,
  selectedKey,
  onUse,
  readOnly,
}: {
  editorRef: EditorRef;
  drafts: EditorAsset[];
  selectedKey: string | null;
  onUse: (a: EditorAsset) => void;
  readOnly: boolean;
}) {
  const t = useTranslations("content.editor.image.drafts");
  if (!drafts.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-body-sm font-medium text-fg">{t("title")}</p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {drafts.map((a) => (
          <li key={a.id} className="space-y-2 rounded-md border border-subtle p-2">
            <Thumb url={a.thumb} alt={a.alt} />
            {a.commercialUse ? (
              <Badge variant={a.commercialUse === "verified" ? "success" : "warning"}>
                {t(`commercialUse.${a.commercialUse}`)}
              </Badge>
            ) : null}
            <div className="flex flex-wrap gap-1">
              {!readOnly ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={a.key === selectedKey}
                  onClick={() => onUse(a)}
                >
                  {a.key === selectedKey ? t("inUse") : t("use")}
                </Button>
              ) : null}
              <ActionButton
                size="sm"
                action={() =>
                  decideAssetAction({
                    slug: r.slug,
                    clientId: r.clientId,
                    id: a.id,
                    decision: "approved",
                  })
                }
              >
                <Check aria-hidden />
                {t("approve")}
              </ActionButton>
              <ActionButton
                size="sm"
                variant="ghost"
                confirm={a.key === selectedKey ? t("rejectConfirm") : undefined}
                action={() =>
                  decideAssetAction({
                    slug: r.slug,
                    clientId: r.clientId,
                    id: a.id,
                    decision: "rejected",
                  })
                }
              >
                <X aria-hidden />
                {t("reject")}
              </ActionButton>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
