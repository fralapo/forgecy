"use client";

import { listeningPlatforms, type ListeningPlatform, type ListeningStatus } from "@forgecy/core";
import { Badge, Button, Input, Label } from "@forgecy/ui";
import { ExternalLink, Lightbulb, Pencil, Trash2 } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { controlClass } from "../../../content/_components/action-button";
import {
  createSignalAction,
  deleteSignalAction,
  markSignalAction,
  updateSignalAction,
  type ActionResult,
} from "./actions";

export interface SignalView {
  id: string;
  text: string;
  platform: ListeningPlatform;
  url: string | null;
  /** yyyy-mm-dd, for the date input. */
  day: string;
  /** Date shown to the person. */
  when: string;
  tag: string | null;
  status: ListeningStatus;
}

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult>, after?: () => void) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error);
      after?.();
      router.refresh();
    });
  };
  return { pending, error, run };
}

/** Add or edit form for one signal. */
export function SignalForm({
  slug,
  signal,
  onDone,
}: {
  slug: string;
  signal?: SignalView;
  onDone?: () => void;
}) {
  const t = useTranslations("clients.listening");
  const id = useId();
  const [text, setText] = useState(signal?.text ?? "");
  const [platform, setPlatform] = useState<ListeningPlatform>(signal?.platform ?? "instagram");
  const [url, setUrl] = useState(signal?.url ?? "");
  const [day, setDay] = useState(signal?.day ?? "");
  const [tag, setTag] = useState(signal?.tag ?? "");
  const { pending, error, run } = useRun();

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const body = { text, platform, url, tag, ...(day ? { occurredAt: new Date(day) } : {}) };
        run(
          () =>
            signal ? updateSignalAction(slug, signal.id, body) : createSignalAction(slug, body),
          () => {
            if (!signal) {
              setText("");
              setUrl("");
              setTag("");
            }
            onDone?.();
          },
        );
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor={`${id}-text`}>{t("form.text")}</Label>
        <textarea
          id={`${id}-text`}
          required
          rows={3}
          maxLength={2000}
          className={controlClass}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <div className="grid gap-2">
          <Label htmlFor={`${id}-platform`}>{t("form.platform")}</Label>
          <select
            id={`${id}-platform`}
            className={controlClass}
            value={platform}
            onChange={(e) => setPlatform(e.target.value as ListeningPlatform)}
          >
            {listeningPlatforms.map((p) => (
              <option key={p} value={p}>
                {t(`platform.${p}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-date`}>{t("form.date")}</Label>
          <Input
            id={`${id}-date`}
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-tag`}>{t("form.tag")}</Label>
          <Input
            id={`${id}-tag`}
            maxLength={60}
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder={t("form.tagPlaceholder")}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-url`}>{t("form.url")}</Label>
          <Input
            id={`${id}-url`}
            type="url"
            maxLength={2000}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t("form.saving") : t("form.save")}
        </Button>
        {signal ? (
          <Button type="button" variant="secondary" onClick={onDone}>
            {t("form.cancel")}
          </Button>
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

const statusVariant = {
  new: "neutral",
  recurring: "warning",
  used: "success",
  dismissed: "neutral",
} as const;

/** One logged signal with its marks, edit and delete. */
export function SignalRow({
  slug,
  signal,
  canWrite,
}: {
  slug: string;
  signal: SignalView;
  canWrite: boolean;
}) {
  const t = useTranslations("clients.listening");
  const [editing, setEditing] = useState(false);
  const { pending, error, run } = useRun();
  const marks = (["recurring", "used", "dismissed", "new"] as const).filter(
    (s) => s !== signal.status,
  );

  if (editing)
    return (
      <li className="py-4">
        <SignalForm slug={slug} signal={signal} onDone={() => setEditing(false)} />
      </li>
    );
  return (
    <li className="space-y-2 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={statusVariant[signal.status]}>{t(`status.${signal.status}`)}</Badge>
        <Badge>{t(`platform.${signal.platform}`)}</Badge>
        {signal.tag ? <Badge variant="info">{signal.tag}</Badge> : null}
        <span className="text-body-sm text-fg-muted">{signal.when}</span>
        {signal.url ? (
          <a
            href={signal.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-body-sm text-link underline-offset-2 hover:underline"
          >
            <ExternalLink aria-hidden className="size-4" />
            {t("actions.openLink")}
          </a>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap text-body-md text-fg">{signal.text}</p>
      {canWrite ? (
        <div className="flex flex-wrap items-center gap-2">
          {marks.map((s) => (
            <Button
              key={s}
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => run(() => markSignalAction(slug, signal.id, s))}
            >
              {t(`actions.${s}`)}
            </Button>
          ))}
          <Button size="sm" variant="secondary" asChild>
            <Link href={`/content/${slug}/carousels/new?signal=${signal.id}` as Route}>
              <Lightbulb aria-hidden />
              {t("actions.toIdea")}
            </Link>
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            <Pencil aria-hidden />
            {t("actions.edit")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => {
              if (window.confirm(t("actions.deleteConfirm")))
                run(() => deleteSignalAction(slug, signal.id));
            }}
          >
            <Trash2 aria-hidden />
            {t("actions.delete")}
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
    </li>
  );
}
