"use client";

import { Badge, Button, Label } from "@forgecy/ui";
import { Check, ImageOff, Sparkles, Undo2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  decideAssetAction,
  decideSlideEditAction,
  generateImageAction,
  requestSlideEditAction,
} from "../actions";
import { formatDate } from "../_lib/paths";
import { ActionButton, controlClass } from "./action-button";
import {
  actionMessage,
  type CommercialUse,
  type EditorAsset,
  type EditorEdit,
  type EditorRef,
} from "./editor-workspace";

const editStatus: Record<
  EditorEdit["status"],
  { label: string; variant: "neutral" | "info" | "success" | "warning" | "error" }
> = {
  queued: { label: "In progress", variant: "info" },
  applied: { label: "To decide", variant: "warning" },
  kept: { label: "Kept", variant: "success" },
  reverted: { label: "Reverted", variant: "neutral" },
  failed: { label: "Failed", variant: "error" },
};

const commercialUseLabels: Record<CommercialUse, string> = {
  verified: "Commercial use verified",
  pending_verification: "Provider’s commercial use to be verified",
  rejected: "Commercial use rejected",
};

export function Thumb({ url, alt }: { url: string | null; alt: string }) {
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
      <span className="sr-only">Preview unavailable</span>
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
        Ask the AI
      </h2>
      <p className="text-body-sm text-fg-muted">
        The Copywriter rewrites only this slide and doesn’t touch protected fields. The edit still
        has to be confirmed.
      </p>
      <div className="space-y-1">
        <Label htmlFor={`ai-instruction-${slideId}`}>Instruction</Label>
        <textarea
          id={`ai-instruction-${slideId}`}
          rows={2}
          maxLength={500}
          className={controlClass}
          value={instruction}
          disabled={disabled || pending}
          placeholder="E.g. make the title more direct and shorten the text"
          onChange={(e) => setInstruction(e.target.value)}
        />
      </div>
      <Button
        variant="secondary"
        disabled={disabled || pending || !valid}
        onClick={() =>
          start(async () => {
            setError(null);
            if (!(await flush())) return setError("Save pending changes first.");
            const res = await requestSlideEditAction({ ...base, slideId, instruction });
            if (!res.ok) return setError(actionMessage(res));
            setInstruction("");
            router.refresh();
          })
        }
      >
        <Sparkles aria-hidden />
        Ask the AI
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
                <Badge variant={editStatus[e.status].variant}>{editStatus[e.status].label}</Badge>“
                {e.instruction}”
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
                    Keep
                  </ActionButton>
                  <ActionButton
                    size="sm"
                    variant="secondary"
                    action={async () => {
                      if (!(await flush()))
                        return { ok: false, error: "Save pending changes first." };
                      return decideSlideEditAction({ ...base, editId: e.id, decision: "revert" });
                    }}
                  >
                    <Undo2 aria-hidden />
                    Undo edit
                  </ActionButton>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {past.length ? (
        <details className="text-body-sm">
          <summary className="cursor-pointer text-fg-muted">Previous requests</summary>
          <ul className="mt-2 space-y-1">
            {past.map((e) => (
              <li key={e.id} className="text-fg">
                <Badge variant={editStatus[e.status].variant}>{editStatus[e.status].label}</Badge> “
                {e.instruction}” · {formatDate(e.createdAt)}
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
        Generate with AI
      </Button>
    );
  return (
    <div
      role="group"
      aria-labelledby={`${id}-title`}
      className="space-y-3 rounded-md border border-control p-3"
    >
      <p id={`${id}-title`} className="text-body-sm font-medium text-fg">
        Generate an image with AI
      </p>
      <div className="space-y-1">
        <Label htmlFor={`${id}-brief`}>What it should show</Label>
        <textarea
          id={`${id}-brief`}
          rows={3}
          maxLength={1000}
          className={controlClass}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Subject, setting, framing. The style comes from the Brand Identity."
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-variants`}>Variants</Label>
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
      <p className="text-body-sm text-fg-muted">
        The images land in the library as “To approve”: the carousel can’t be approved until the
        ones it uses are approved.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={pending || brief.trim().length < 3}
          onClick={() =>
            start(async () => {
              setMessage(null);
              if (!(await flush()))
                return setMessage({ ok: false, text: "Save pending changes first." });
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
              setMessage({ ok: true, text: "Generation started: the images will appear here." });
              setBrief("");
              router.refresh();
            })
          }
        >
          <Sparkles aria-hidden />
          Generate
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Close
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
  if (!drafts.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-body-sm font-medium text-fg">AI images to approve</p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {drafts.map((a) => (
          <li key={a.id} className="space-y-2 rounded-md border border-subtle p-2">
            <Thumb url={a.thumb} alt={a.alt} />
            {a.commercialUse ? (
              <Badge variant={a.commercialUse === "verified" ? "success" : "warning"}>
                {commercialUseLabels[a.commercialUse]}
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
                  {a.key === selectedKey ? "In use" : "Use"}
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
                Approve
              </ActionButton>
              <ActionButton
                size="sm"
                variant="ghost"
                confirm={
                  a.key === selectedKey
                    ? "The image is used in the slide: reject it anyway?"
                    : undefined
                }
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
                Reject
              </ActionButton>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
