"use client";

import {
  captionLimits,
  computeChecks,
  normalizeHashtag,
  type CarouselDocument,
  type CheckInput,
  type ContentChannel,
  type ContentCheck,
  type GuardReport,
} from "@forgecy/content/client";
import { GUARDED_CHECK_PREFIXES } from "@forgecy/content/client";
import { visibleLength, type TemplateManifest } from "@forgecy/carousel";
import type { ContentStatus } from "@forgecy/core";
import { Badge, Button, Input, Label } from "@forgecy/ui";
import { AlertTriangle, History, Lock, RefreshCw, Save, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  resolveCommentAction,
  saveDraftAction,
  saveVersionAction,
  submitAction,
  withdrawAction,
  type ActionResult,
} from "../actions";
import { formatDate } from "../_lib/paths";
import { ActionButton, controlClass } from "./action-button";
import { SlideAiPanel } from "./editor-ai";
import { SlideList, SlidePanel } from "./editor-slides";
import { RefreshWhile } from "./refresh-while";
import { plural } from "@/lib/plural";

export type CommercialUse = "verified" | "pending_verification" | "rejected";

export interface EditorAsset {
  id: string;
  key: string;
  status: "draft" | "approved" | "rejected";
  source: "upload" | "ai" | "product";
  alt: string;
  width: number | null;
  height: number | null;
  thumb: string | null;
  /** AI images only. */
  commercialUse: CommercialUse | null;
  /** AI images: slide and slot they were generated for. */
  slideId: string | null;
  slot: string | null;
  forThisContent: boolean;
}

export interface EditorEdit {
  id: string;
  slideId: string;
  instruction: string;
  status: "queued" | "applied" | "kept" | "reverted" | "failed";
  note: string | null;
  createdAt: string;
}

export interface EditorComment {
  id: string;
  slideId: string | null;
  body: string;
  authorName: string | null;
  createdAt: string;
}

export type CheckContext = Omit<CheckInput, "document" | "manifest" | "channel" | "assets">;

/** What every editor sub-component needs to call an action on this carousel. */
export interface EditorRef {
  slug: string;
  clientId: string;
  contentId: string;
}

type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

const AUTOSAVE_MS = 1200;
/** Force grouping so Node and the browser format counts the same way and hydration matches. */
const countFormat = new Intl.NumberFormat("en-GB", { useGrouping: "always" });

/** User-facing message of an action error, by its code. */
export function actionMessage(r: Extract<ActionResult, { ok: false }>): string {
  switch (r.code) {
    case "CONFLICT-DRAFT-REV":
      return "Someone else edited the carousel while you were editing it too.";
    case "CONTENT-IN-REVIEW":
      return "The carousel is in review: withdraw it from review to edit it.";
    case "CONTENT-LOCKED":
      return "The AI is working on this carousel: wait for it to finish.";
    case "CHECKS-BLOCKING":
      return "Fix the blocking issues before continuing.";
    case "BRAND-NOT-PUBLISHED":
      return "Publish the client’s Brand Identity first.";
    case "PERM-DENIED":
      return "You don’t have permission for this action.";
    default:
      return r.error;
  }
}

/** Checks attached to an error result (CHECKS-BLOCKING, CHECKS-UNACKNOWLEDGED). */
export function detailChecks(r: Extract<ActionResult, { ok: false }>): ContentCheck[] {
  const list = r.details?.checks;
  return Array.isArray(list) ? (list as ContentCheck[]) : [];
}

export interface EditorWorkspaceProps extends EditorRef {
  basePath: string;
  status: ContentStatus;
  locked: boolean;
  busy: boolean;
  reviewNote: string | null;
  draftRev: number;
  document: CarouselDocument;
  updatedByName: string | null;
  updatedAt: string | null;
  manifest: TemplateManifest | null;
  channel: ContentChannel;
  checkContext: CheckContext;
  guard: GuardReport | null;
  library: EditorAsset[];
  edits: EditorEdit[];
  comments: EditorComment[];
}

export function EditorWorkspace(props: EditorWorkspaceProps) {
  const router = useRouter();
  const ref: EditorRef = { slug: props.slug, clientId: props.clientId, contentId: props.contentId };
  const [doc, setDoc] = useState(props.document);
  const [rev, setRev] = useState(props.draftRev);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(props.document.slides[0]?.id ?? null);
  const [seenRev, setSeenRev] = useState(props.draftRev);
  const [hashtagText, setHashtagText] = useState(props.document.hashtags.join(" "));
  // Slides in the draft stored on the server: the preview route renders only those.
  const [savedIds, setSavedIds] = useState(() => slideIds(props.document));

  // A newer draft from the server (AI edit, revert, another tab): take it when nothing is pending here.
  if (props.draftRev !== seenRev) {
    setSeenRev(props.draftRev);
    if (saveState === "saved" && props.draftRev > rev) {
      setDoc(props.document);
      setRev(props.draftRev);
      setSavedIds(slideIds(props.document));
      setHashtagText(props.document.hashtags.join(" "));
    }
  }

  const readOnly = props.status === "in_review" || props.status === "archived" || props.locked;

  const docRef = useRef(doc);
  const revRef = useRef(rev);
  const dirtyRef = useRef(false);
  const inflight = useRef<Promise<boolean> | null>(null);
  useEffect(() => {
    docRef.current = doc;
    revRef.current = rev;
  });

  const save = useCallback(async (): Promise<boolean> => {
    if (inflight.current) await inflight.current;
    if (!dirtyRef.current) return true;
    const run = (async () => {
      dirtyRef.current = false;
      setSaveState("saving");
      const sent = docRef.current;
      const r = await saveDraftAction({
        slug: ref.slug,
        clientId: ref.clientId,
        id: ref.contentId,
        draftRev: revRef.current,
        document: sent,
      });
      if (r.ok) {
        revRef.current = r.draftRev;
        setRev(r.draftRev);
        setSavedIds(slideIds(sent));
        setSaveError(null);
        setSaveState(dirtyRef.current ? "dirty" : "saved");
        return true;
      }
      dirtyRef.current = true;
      if (r.code === "CONFLICT-DRAFT-REV") {
        setSaveState("conflict");
        router.refresh();
      } else {
        setSaveState("error");
        setSaveError(actionMessage(r));
      }
      return false;
    })();
    inflight.current = run;
    try {
      return await run;
    } finally {
      inflight.current = null;
    }
  }, [ref.slug, ref.clientId, ref.contentId, router]);

  const autosave = useEffectEvent(() => {
    void save();
  });
  useEffect(() => {
    if (saveState !== "dirty") return;
    const t = setTimeout(autosave, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [doc, saveState]);

  useEffect(() => {
    if (saveState === "saved") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  /** Every edit goes through here: marks the draft dirty and restarts the autosave timer. */
  const update = useCallback(
    (fn: (d: CarouselDocument) => CarouselDocument) => {
      if (readOnly) return;
      dirtyRef.current = true;
      setDoc((d) => fn(d));
      setSaveState((s) => (s === "conflict" ? s : "dirty"));
    },
    [readOnly],
  );

  /** Saves pending changes before an action that reads the draft on the server. */
  const flush = useCallback(async () => {
    if (saveState === "conflict") return false;
    return save();
  }, [save, saveState]);

  function reloadFromServer() {
    dirtyRef.current = false;
    setDoc(props.document);
    setRev(props.draftRev);
    setSavedIds(slideIds(props.document));
    setHashtagText(props.document.hashtags.join(" "));
    setSaveState("saved");
    setSaveError(null);
  }

  const assetInfo = useMemo(
    () =>
      new Map(
        props.library.map((a) => [
          a.key,
          {
            status: a.status,
            source: a.source,
            alt: a.alt,
            commercialUsePending: a.source === "ai" && a.commercialUse !== "verified",
          },
        ]),
      ),
    [props.library],
  );
  const checks = useMemo(() => {
    const all = computeChecks({
      ...props.checkContext,
      document: doc,
      manifest: props.manifest,
      channel: props.channel,
      assets: assetInfo,
    });
    return props.guard
      ? all.filter((c) => !GUARDED_CHECK_PREFIXES.some((p) => c.id.startsWith(p)))
      : all;
  }, [doc, props.manifest, props.channel, props.checkContext, props.guard, assetInfo]);

  const selectedIndex = Math.max(
    0,
    doc.slides.findIndex((s) => s.id === selectedId),
  );
  const selected = doc.slides[selectedIndex] ?? null;
  const globalChecks = checks.filter((c) => !c.slideId);
  const limit = captionLimits[props.channel];
  const captionLen = visibleLength(doc.caption);
  const queuedEdit = props.edits.some((e) => e.status === "queued");

  return (
    <div className="space-y-4">
      <RefreshWhile active={props.busy || queuedEdit} />
      <StatusBanners {...props} editorRef={ref} />

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-subtle bg-surface p-4">
        <div className="min-w-64 flex-1 space-y-1">
          <Label htmlFor="doc-title">Carousel title</Label>
          <Input
            id="doc-title"
            value={doc.title}
            maxLength={160}
            disabled={readOnly}
            onChange={(e) => {
              const title = e.target.value;
              update((d) => ({ ...d, title }));
            }}
          />
        </div>
        <SaveIndicator state={saveState} readOnly={readOnly} />
        <VersionAndSubmit
          editorRef={ref}
          basePath={props.basePath}
          disabled={readOnly || saveState === "conflict" || !doc.slides.length}
          flush={flush}
          rev={() => revRef.current}
          blocking={checks.filter((c) => c.severity === "error").length}
        />
      </div>

      {saveState === "conflict" ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border border-error-fill bg-surface px-4 py-3 text-body-sm text-fg"
        >
          <AlertTriangle aria-hidden className="size-5 text-error" />
          <span className="flex-1">
            The carousel was edited
            {props.updatedByName ? ` by ${props.updatedByName}` : " by another session"}
            {props.updatedAt ? ` (${formatDate(props.updatedAt)})` : ""} while you were editing it.
            Your latest changes were not saved.
          </span>
          <Button variant="secondary" size="sm" onClick={reloadFromServer}>
            <RefreshCw aria-hidden />
            Reload the saved version
          </Button>
        </div>
      ) : null}
      {saveState === "error" && saveError ? (
        <p role="alert" className="text-body-sm text-error">
          Save failed: {saveError}{" "}
          <button type="button" className="underline" onClick={() => void save()}>
            Retry
          </button>
        </p>
      ) : null}

      {!props.manifest ? (
        <p role="alert" className="text-body-sm text-error">
          The carousel template is unavailable: the slides can’t be edited.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_24rem]">
          <SlideList
            doc={doc}
            manifest={props.manifest}
            checks={checks}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            update={update}
            readOnly={readOnly}
          />
          <div className="min-w-0 space-y-6">
            {selected ? (
              <>
                <SlidePanel
                  key={selected.id}
                  editorRef={ref}
                  slide={selected}
                  index={selectedIndex}
                  total={doc.slides.length}
                  manifest={props.manifest}
                  library={props.library}
                  update={update}
                  readOnly={readOnly}
                  flush={flush}
                />
                <SlideAiPanel
                  editorRef={ref}
                  slideId={selected.id}
                  edits={props.edits.filter((e) => e.slideId === selected.id)}
                  disabled={readOnly || props.busy}
                  flush={flush}
                />
              </>
            ) : (
              <p className="rounded-lg border border-dashed border-subtle p-6 text-body-sm text-fg-muted">
                The carousel has no slides yet: add one from the list.
              </p>
            )}
          </div>
          <aside className="space-y-4 lg:col-span-2 xl:col-span-1">
            {selected && savedIds.has(selected.id) ? (
              <SlidePreview
                src={`${props.basePath}/preview?slide=${encodeURIComponent(selected.id)}&rev=${rev}`}
                manifest={props.manifest}
                index={selectedIndex}
                stale={saveState !== "saved"}
              />
            ) : selected ? (
              <p className="rounded-lg border border-dashed border-subtle p-6 text-body-sm text-fg-muted">
                {saveState === "error" || saveState === "conflict"
                  ? "The preview of this slide appears once the draft is saved."
                  : "New slide: the preview appears after the autosave."}
              </p>
            ) : null}
            <ChecksBox
              title={selected ? `Slide ${selectedIndex + 1} checks` : "Checks"}
              checks={checks.filter((c) => c.slideId && c.slideId === selected?.id)}
            />
            <ChecksBox title="Carousel checks" checks={globalChecks} />
            {props.guard ? (
              <GuardSummary guard={props.guard} slideIndex={selected ? selectedIndex : null} />
            ) : null}
            <SlideComments
              editorRef={ref}
              comments={props.comments.filter((c) => c.slideId === (selected?.id ?? null))}
            />
          </aside>
        </div>
      )}

      <section
        aria-labelledby="caption-title"
        className="space-y-4 rounded-lg border border-subtle bg-surface p-4"
      >
        <h2 id="caption-title" className="text-heading-sm text-fg">
          Caption and hashtags
        </h2>
        <div className="space-y-1">
          <Label htmlFor="doc-caption">Caption</Label>
          <textarea
            id="doc-caption"
            rows={6}
            className={controlClass}
            value={doc.caption}
            disabled={readOnly}
            aria-describedby="doc-caption-count"
            onChange={(e) => {
              const caption = e.target.value;
              update((d) => ({ ...d, caption }));
            }}
          />
          <p
            id="doc-caption-count"
            className={
              captionLen > limit ? "text-body-sm text-error" : "text-body-sm text-fg-muted"
            }
          >
            {countFormat.format(captionLen)} / {countFormat.format(limit)} characters (
            {props.channel === "linkedin" ? "LinkedIn" : "Instagram"})
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="doc-hashtags">Hashtags</Label>
          <Input
            id="doc-hashtags"
            value={hashtagText}
            disabled={readOnly}
            placeholder="#example #another"
            aria-describedby="doc-hashtags-hint"
            onChange={(e) => {
              const text = e.target.value;
              setHashtagText(text);
              const tags = [
                ...new Set(
                  text
                    .split(/[\s,]+/)
                    .map(normalizeHashtag)
                    .filter(Boolean),
                ),
              ].slice(0, 30);
              update((d) => ({ ...d, hashtags: tags }));
            }}
            onBlur={() => setHashtagText(doc.hashtags.join(" "))}
          />
          <p id="doc-hashtags-hint" className="text-body-sm text-fg-muted">
            {plural(doc.hashtags.length, "hashtag", "hashtags")}
            {props.checkContext.maxHashtags !== undefined
              ? ` (the Brand Identity allows at most ${props.checkContext.maxHashtags})`
              : ""}
            . Separate them with a space.
          </p>
        </div>
      </section>
    </div>
  );
}

function StatusBanners(props: EditorWorkspaceProps & { editorRef: EditorRef }) {
  const r = props.editorRef;
  return (
    <>
      {props.status === "in_review" ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-md border border-warning-fill bg-surface px-4 py-3 text-body-sm text-fg"
        >
          <Lock aria-hidden className="size-5 text-warning" />
          <span className="flex-1">
            The carousel is in review: to edit it, withdraw it from review.
          </span>
          <ActionButton
            variant="secondary"
            size="sm"
            confirm="Withdraw the carousel from review? It will go back to draft."
            action={() => withdrawAction({ slug: r.slug, clientId: r.clientId, id: r.contentId })}
          >
            Withdraw from review
          </ActionButton>
        </div>
      ) : null}
      {props.locked ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-md border border-primary bg-surface px-4 py-3 text-body-sm text-fg"
        >
          <RefreshCw aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
          The AI is working on this carousel: editing resumes as soon as it finishes.
        </p>
      ) : null}
      {props.status === "archived" ? (
        <p role="status" className="text-body-sm text-fg-muted">
          Carousel archived: restore it to edit it.
        </p>
      ) : null}
      {props.reviewNote ? (
        <div className="rounded-md border border-error-fill bg-surface px-4 py-3 text-body-sm text-fg">
          <p className="font-medium text-error">Changes requested in review</p>
          <p className="mt-1 whitespace-pre-line">{props.reviewNote}</p>
        </div>
      ) : null}
      {props.status === "approved" || props.status === "exported" ? (
        <p role="status" className="text-body-sm text-fg-muted">
          The carousel is approved: if you edit it, it goes back to draft and must be approved
          again.
        </p>
      ) : null}
    </>
  );
}

function SaveIndicator({ state, readOnly }: { state: SaveState; readOnly: boolean }) {
  if (readOnly) return <Badge icon={Lock}>Read-only</Badge>;
  const map: Record<
    SaveState,
    { label: string; variant: "neutral" | "success" | "warning" | "error" | "info" }
  > = {
    saved: { label: "Saved", variant: "success" },
    dirty: { label: "Unsaved changes", variant: "neutral" },
    saving: { label: "Saving…", variant: "info" },
    error: { label: "Not saved", variant: "error" },
    conflict: { label: "Conflict", variant: "error" },
  };
  return (
    <span aria-live="polite">
      <Badge variant={map[state].variant}>{map[state].label}</Badge>
    </span>
  );
}

function VersionAndSubmit({
  editorRef: r,
  basePath,
  disabled,
  flush,
  rev,
  blocking,
}: {
  editorRef: EditorRef;
  basePath: string;
  disabled: boolean;
  flush: () => Promise<boolean>;
  rev: () => number;
  blocking: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [blockers, setBlockers] = useState<ContentCheck[]>([]);
  const base = { slug: r.slug, clientId: r.clientId, id: r.contentId };

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setMessage(null);
      setBlockers([]);
      if (!(await flush())) {
        setMessage({ ok: false, text: "Save pending changes first." });
        return;
      }
      await fn();
    });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="version-note">Version note</Label>
          <Input
            id="version-note"
            value={note}
            maxLength={300}
            className="w-56"
            placeholder="Optional"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <Button
          variant="secondary"
          disabled={disabled || pending}
          onClick={() =>
            run(async () => {
              const res = await saveVersionAction({
                ...base,
                draftRev: rev(),
                ...(note.trim() ? { note: note.trim() } : {}),
              });
              if (!res.ok) return setMessage({ ok: false, text: actionMessage(res) });
              setNote("");
              setMessage({ ok: true, text: `Version ${res.number} saved.` });
              router.refresh();
            })
          }
        >
          <History aria-hidden />
          Save version
        </Button>
        <Button
          disabled={disabled || pending}
          title={blocking ? plural(blocking, "blocking issue", "blocking issues") : undefined}
          onClick={() =>
            run(async () => {
              const res = await submitAction({ ...base, draftRev: rev() });
              if (!res.ok) {
                setBlockers(detailChecks(res));
                return setMessage({ ok: false, text: actionMessage(res) });
              }
              router.push(`${basePath}/review` as Route);
            })
          }
        >
          <Send aria-hidden />
          Submit for review
        </Button>
      </div>
      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? "text-body-sm text-success" : "text-body-sm text-error"}
        >
          {message.ok ? <Save aria-hidden className="mr-1 inline size-4" /> : null}
          {message.text}
        </p>
      ) : null}
      {blockers.length ? (
        <ul className="list-disc space-y-1 pl-5 text-body-sm text-error">
          {blockers.map((c) => (
            <li key={c.id}>{c.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const slideIds = (d: CarouselDocument) => new Set(d.slides.map((x) => x.id));

function SlidePreview({
  src,
  manifest,
  index,
  stale,
}: {
  src: string;
  manifest: TemplateManifest;
  index: number;
  stale: boolean;
}) {
  const width = 384;
  const scale = width / manifest.width;
  return (
    <figure className="space-y-2">
      <div
        className="overflow-hidden rounded-md border border-subtle bg-app"
        style={{ width: manifest.width * scale, height: manifest.height * scale }}
      >
        <iframe
          key={src}
          src={src}
          title={`Preview of slide ${index + 1}`}
          sandbox=""
          width={manifest.width}
          height={manifest.height}
          className="origin-top-left border-0"
          style={{ transform: `scale(${scale})` }}
        />
      </div>
      <figcaption className="text-body-sm text-fg-muted">
        {stale
          ? "Preview of the last save: it updates after the autosave."
          : `Slide ${index + 1}, as it will be exported.`}
      </figcaption>
    </figure>
  );
}

function ChecksBox({ title, checks }: { title: string; checks: ContentCheck[] }) {
  return (
    <section className="space-y-2 rounded-lg border border-subtle bg-surface p-4">
      <h3 className="text-label text-fg">{title}</h3>
      {checks.length ? (
        <ul className="space-y-2">
          {checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-body-sm text-fg">
              <Badge variant={c.severity === "error" ? "error" : "warning"}>
                {c.severity === "error" ? "Blocking" : "Warning"}
              </Badge>
              <span>{c.message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-sm text-success">No issues.</p>
      )}
    </section>
  );
}

function GuardSummary({ guard, slideIndex }: { guard: GuardReport; slideIndex: number | null }) {
  const open = guard.findings.filter(
    (f) => f.status === "open" && f.severity !== "note" && f.slide === slideIndex,
  );
  return (
    <section className="space-y-2 rounded-lg border border-subtle bg-surface p-4">
      <h3 className="text-label text-fg">Brand Guard (last save)</h3>
      {open.length ? (
        <ul className="space-y-2">
          {open.map((f) => (
            <li key={f.key} className="text-body-sm text-fg">
              <Badge variant={f.severity === "error" ? "error" : "warning"}>
                {f.severity === "error" ? "Error" : "Warning"}
              </Badge>{" "}
              {f.message}
              {f.suggestion ? (
                <span className="block text-fg-muted">Suggestion: {f.suggestion}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-sm text-success">No findings on this slide.</p>
      )}
    </section>
  );
}

function SlideComments({
  editorRef: r,
  comments,
}: {
  editorRef: EditorRef;
  comments: EditorComment[];
}) {
  if (!comments.length) return null;
  return (
    <section className="space-y-2 rounded-lg border border-subtle bg-surface p-4">
      <h3 className="text-label text-fg">Open comments</h3>
      <ul className="space-y-3">
        {comments.map((c) => (
          <li key={c.id} className="space-y-1 text-body-sm">
            <p className="whitespace-pre-line text-fg">{c.body}</p>
            <p className="text-fg-muted">
              {c.authorName ?? "Removed user"} · {formatDate(c.createdAt)}
            </p>
            <ActionButton
              variant="ghost"
              size="sm"
              action={() =>
                resolveCommentAction({
                  slug: r.slug,
                  clientId: r.clientId,
                  id: r.contentId,
                  commentId: c.id,
                })
              }
            >
              Mark as resolved
            </ActionButton>
          </li>
        ))}
      </ul>
    </section>
  );
}
