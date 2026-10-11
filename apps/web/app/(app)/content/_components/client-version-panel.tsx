"use client";

import type { MessageRef } from "@forgecy/core";
import { Button, Input, Label } from "@forgecy/ui";
import { FileUp, Lightbulb, Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, useTransition } from "react";
import { useRefText } from "@/lib/use-format";
import { proposeLessonFromChangeAction, saveClientChangesAction } from "../actions";
import { controlClass } from "./action-button";

interface Note {
  id: string;
  slide: number | null;
  text: string;
  lessonId: string | null;
}

/**
 * The client's edited version of a delivered carousel: the files, the per-slide notes of what
 * changed, and “Propose as lesson” (a proposal a person confirms later in the lessons log).
 */
export function ClientVersionPanel({
  slug,
  clientId,
  contentId,
  canAttach,
  canNote,
  canPropose,
  slides,
  pdf,
  attachedAt,
  initialNotes,
  slideCount,
}: {
  slug: string;
  clientId: string;
  contentId: string;
  canAttach: boolean;
  canNote: boolean;
  canPropose: boolean;
  slides: { id: string; slide: number; url: string; alt: string }[];
  pdf: { name: string; url: string } | null;
  attachedAt: string | null;
  initialNotes: Note[];
  slideCount: number;
}) {
  const t = useTranslations("content.export.clientVersion");
  const router = useRouter();
  const refText = useRefText();
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const ref = { slug, clientId, id: contentId };
  const attached = attachedAt !== null;

  const edit = (next: Note[]) => {
    setNotes(next);
    setDirty(true);
  };
  const patch = (noteId: string, p: Partial<Note>) =>
    edit(notes.map((n) => (n.id === noteId ? { ...n, ...p } : n)));

  const done = (r: { ok: boolean; error?: string }, text: string) => {
    setMessage(r.ok ? { error: false, text } : { error: true, text: r.error ?? "" });
    if (r.ok) router.refresh();
  };

  return (
    <div className="grid gap-5">
      {canAttach ? (
        <form
          ref={form}
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            setMessage(null);
            start(async () => {
              const res = await fetch(`/content/${slug}/carousels/${contentId}/client-version`, {
                method: "POST",
                body: data,
                headers: { accept: "application/json" },
              });
              const body = (await res.json().catch(() => ({}))) as {
                message?: string;
                ref?: MessageRef | null;
              };
              if (!res.ok)
                return setMessage({
                  error: true,
                  text: body.message ? refText(body.ref, body.message) : t("failed"),
                });
              form.current?.reset();
              setMessage({ error: false, text: t("attached") });
              router.refresh();
            });
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor={`${id}-slides`}>{t("slidesLabel")}</Label>
            <input
              id={`${id}-slides`}
              name="slides"
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              className={controlClass}
            />
            <p className="text-body-sm text-fg-muted">{t("slidesHint")}</p>
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${id}-pdf`}>{t("pdfLabel")}</Label>
            <input
              id={`${id}-pdf`}
              name="pdf"
              type="file"
              accept="application/pdf"
              className={controlClass}
            />
          </div>
          <div>
            <Button type="submit" variant={attached ? "secondary" : "primary"} disabled={pending}>
              <FileUp aria-hidden />
              {attached ? t("replace") : t("attach")}
            </Button>
          </div>
        </form>
      ) : null}

      {attached ? (
        <section className="grid gap-3" aria-label={t("filesTitle")}>
          <p role="status" className="text-body-sm text-fg">
            {t("deliveredIsClient", { date: attachedAt })}
          </p>
          {slides.length ? (
            <ul className="flex flex-wrap gap-3">
              {slides.map((s) => (
                <li key={s.id} className="grid w-28 gap-1">
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
                  <img
                    src={s.url}
                    alt={t("slideAlt", { number: s.slide })}
                    className="aspect-[4/5] w-full rounded-md border border-subtle object-cover"
                  />
                  <span className="text-label text-fg-muted">
                    {t("slide", { number: s.slide })}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {pdf ? (
            <p className="text-body-sm">
              <a href={pdf.url} download={pdf.name}>
                {t("pdfLink", { name: pdf.name })}
              </a>
            </p>
          ) : null}
        </section>
      ) : (
        <p className="text-body-sm text-fg-muted">{t("none")}</p>
      )}

      {attached ? (
        <section className="grid gap-3" aria-label={t("changesTitle")}>
          <h4 className="text-heading-xs text-fg">{t("changesTitle")}</h4>
          <p className="text-body-sm text-fg-muted">{t("changesHint")}</p>
          <ul className="grid gap-3">
            {notes.map((n, i) => (
              <li key={n.id} className="grid gap-2 rounded-md border border-subtle p-3">
                <div className="grid gap-1 sm:grid-cols-[8rem_1fr]">
                  <div className="grid gap-1">
                    <Label htmlFor={`${id}-s${i}`}>{t("noteSlide")}</Label>
                    <select
                      id={`${id}-s${i}`}
                      className={controlClass}
                      disabled={!canNote}
                      value={n.slide ?? ""}
                      onChange={(e) =>
                        patch(n.id, { slide: e.target.value ? Number(e.target.value) : null })
                      }
                    >
                      <option value="">{t("noteWhole")}</option>
                      {Array.from(
                        { length: Math.max(slideCount, slides.length, n.slide ?? 0) },
                        (_, k) => (
                          <option key={k + 1} value={k + 1}>
                            {t("slide", { number: k + 1 })}
                          </option>
                        ),
                      )}
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`${id}-t${i}`}>{t("noteText")}</Label>
                    <Input
                      id={`${id}-t${i}`}
                      maxLength={600}
                      disabled={!canNote}
                      placeholder={t("notePlaceholder")}
                      value={n.text}
                      onChange={(e) => patch(n.id, { text: e.target.value })}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canNote ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => edit(notes.filter((x) => x.id !== n.id))}
                    >
                      <Trash2 aria-hidden />
                      {t("removeNote")}
                    </Button>
                  ) : null}
                  {n.lessonId ? (
                    <span className="text-body-sm text-fg-muted">{t("lessonProposed")}</span>
                  ) : canPropose ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={pending || dirty || !n.text.trim()}
                      title={dirty ? t("saveFirst") : undefined}
                      onClick={() => {
                        setMessage(null);
                        start(async () => {
                          const r = await proposeLessonFromChangeAction({ ...ref, noteId: n.id });
                          // The refresh does not reset local state: mark the note now (the server
                          // refuses a second lesson for the same note).
                          if (r.ok)
                            setNotes((all) =>
                              all.map((x) => (x.id === n.id ? { ...x, lessonId: "proposed" } : x)),
                            );
                          done(r, t("lessonDone"));
                        });
                      }}
                    >
                      <Lightbulb aria-hidden />
                      {t("proposeLesson")}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {canNote ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={pending || notes.length >= 60}
                onClick={() =>
                  edit([
                    ...notes,
                    { id: crypto.randomUUID(), slide: null, text: "", lessonId: null },
                  ])
                }
              >
                <Plus aria-hidden />
                {t("addNote")}
              </Button>
              <Button
                type="button"
                disabled={pending || !dirty}
                onClick={() => {
                  setMessage(null);
                  start(async () => {
                    const r = await saveClientChangesAction({
                      ...ref,
                      notes: notes.map(({ id: noteId, slide, text }) => ({
                        id: noteId,
                        slide,
                        text,
                      })),
                    });
                    if (r.ok) {
                      setDirty(false);
                      setNotes(notes.filter((x) => x.text.trim()));
                    }
                    done(r, t("changesSaved"));
                  });
                }}
              >
                <Save aria-hidden />
                {t("saveChanges")}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {message ? (
        <p
          role={message.error ? "alert" : "status"}
          className={message.error ? "text-body-sm text-error" : "text-body-sm text-fg-muted"}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
