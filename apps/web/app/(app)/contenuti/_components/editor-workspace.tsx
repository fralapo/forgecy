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

/** Italian message of an action error, by its code. */
export function actionMessage(r: Extract<ActionResult, { ok: false }>): string {
  switch (r.code) {
    case "CONFLICT-DRAFT-REV":
      return "Qualcun altro ha modificato il carosello mentre lo modificavi anche tu.";
    case "CONTENT-IN-REVIEW":
      return "Il carosello è in revisione: ritiralo dalla revisione per modificarlo.";
    case "CONTENT-LOCKED":
      return "L'AI sta lavorando su questo carosello: attendi che finisca.";
    case "CHECKS-BLOCKING":
      return "Risolvi i problemi bloccanti prima di procedere.";
    case "BRAND-NOT-PUBLISHED":
      return "Pubblica prima la Brand Identity del cliente.";
    case "PERM-DENIED":
      return "Non hai il permesso per questa azione.";
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

  // A newer draft from the server (AI edit, revert, another tab): take it when nothing is pending here.
  if (props.draftRev !== seenRev) {
    setSeenRev(props.draftRev);
    if (saveState === "saved" && props.draftRev > rev) {
      setDoc(props.document);
      setRev(props.draftRev);
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
      const r = await saveDraftAction({
        slug: ref.slug,
        clientId: ref.clientId,
        id: ref.contentId,
        draftRev: revRef.current,
        document: docRef.current,
      });
      if (r.ok) {
        revRef.current = r.draftRev;
        setRev(r.draftRev);
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
          <Label htmlFor="doc-title">Titolo del carosello</Label>
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
            Il carosello è stato modificato
            {props.updatedByName ? ` da ${props.updatedByName}` : " da un'altra sessione"}
            {props.updatedAt ? ` (${formatDate(props.updatedAt)})` : ""} mentre lo modificavi. Le
            tue ultime modifiche non sono state salvate.
          </span>
          <Button variant="secondary" size="sm" onClick={reloadFromServer}>
            <RefreshCw aria-hidden />
            Ricarica la versione salvata
          </Button>
        </div>
      ) : null}
      {saveState === "error" && saveError ? (
        <p role="alert" className="text-body-sm text-error">
          Salvataggio non riuscito: {saveError}{" "}
          <button type="button" className="underline" onClick={() => void save()}>
            Riprova
          </button>
        </p>
      ) : null}

      {!props.manifest ? (
        <p role="alert" className="text-body-sm text-error">
          Il template del carosello non è disponibile: le slide non si possono modificare.
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
                Il carosello non ha ancora slide: aggiungine una dall&apos;elenco.
              </p>
            )}
          </div>
          <aside className="space-y-4 lg:col-span-2 xl:col-span-1">
            {selected ? (
              <SlidePreview
                src={`${props.basePath}/anteprima?slide=${encodeURIComponent(selected.id)}&rev=${rev}`}
                manifest={props.manifest}
                index={selectedIndex}
                stale={saveState !== "saved"}
              />
            ) : null}
            <ChecksBox
              title={selected ? `Controlli della slide ${selectedIndex + 1}` : "Controlli"}
              checks={checks.filter((c) => c.slideId && c.slideId === selected?.id)}
            />
            <ChecksBox title="Controlli del carosello" checks={globalChecks} />
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
          Didascalia e hashtag
        </h2>
        <div className="space-y-1">
          <Label htmlFor="doc-caption">Didascalia</Label>
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
            {captionLen.toLocaleString("it-IT")} / {limit.toLocaleString("it-IT")} caratteri (
            {props.channel === "linkedin" ? "LinkedIn" : "Instagram"})
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="doc-hashtags">Hashtag</Label>
          <Input
            id="doc-hashtags"
            value={hashtagText}
            disabled={readOnly}
            placeholder="#esempio #altro"
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
            {doc.hashtags.length} hashtag
            {props.checkContext.maxHashtags !== undefined
              ? ` (la Brand Identity ne prevede al massimo ${props.checkContext.maxHashtags})`
              : ""}
            . Separali con uno spazio.
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
            Il carosello è in revisione: per modificarlo ritiralo dalla revisione.
          </span>
          <ActionButton
            variant="secondary"
            size="sm"
            confirm="Ritirare il carosello dalla revisione? Tornerà in bozza."
            action={() => withdrawAction({ slug: r.slug, clientId: r.clientId, id: r.contentId })}
          >
            Ritira dalla revisione
          </ActionButton>
        </div>
      ) : null}
      {props.locked ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-md border border-primary bg-surface px-4 py-3 text-body-sm text-fg"
        >
          <RefreshCw aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
          L&apos;AI sta lavorando su questo carosello: la modifica riprende appena finisce.
        </p>
      ) : null}
      {props.status === "archived" ? (
        <p role="status" className="text-body-sm text-fg-muted">
          Carosello archiviato: ripristinalo per modificarlo.
        </p>
      ) : null}
      {props.reviewNote ? (
        <div className="rounded-md border border-error-fill bg-surface px-4 py-3 text-body-sm text-fg">
          <p className="font-medium text-error">Modifiche richieste in revisione</p>
          <p className="mt-1 whitespace-pre-line">{props.reviewNote}</p>
        </div>
      ) : null}
      {props.status === "approved" || props.status === "exported" ? (
        <p role="status" className="text-body-sm text-fg-muted">
          Il carosello è approvato: se lo modifichi torna in bozza e va approvato di nuovo.
        </p>
      ) : null}
    </>
  );
}

function SaveIndicator({ state, readOnly }: { state: SaveState; readOnly: boolean }) {
  if (readOnly) return <Badge icon={Lock}>Sola lettura</Badge>;
  const map: Record<
    SaveState,
    { label: string; variant: "neutral" | "success" | "warning" | "error" | "info" }
  > = {
    saved: { label: "Salvato", variant: "success" },
    dirty: { label: "Modifiche da salvare", variant: "neutral" },
    saving: { label: "Salvataggio…", variant: "info" },
    error: { label: "Non salvato", variant: "error" },
    conflict: { label: "Conflitto", variant: "error" },
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
        setMessage({ ok: false, text: "Salva prima le modifiche in sospeso." });
        return;
      }
      await fn();
    });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="version-note">Nota della versione</Label>
          <Input
            id="version-note"
            value={note}
            maxLength={300}
            className="w-56"
            placeholder="Facoltativa"
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
              setMessage({ ok: true, text: `Versione ${res.number} salvata.` });
              router.refresh();
            })
          }
        >
          <History aria-hidden />
          Salva versione
        </Button>
        <Button
          disabled={disabled || pending}
          title={blocking ? `${blocking} problemi bloccanti` : undefined}
          onClick={() =>
            run(async () => {
              const res = await submitAction({ ...base, draftRev: rev() });
              if (!res.ok) {
                setBlockers(detailChecks(res));
                return setMessage({ ok: false, text: actionMessage(res) });
              }
              router.push(`${basePath}/revisione` as Route);
            })
          }
        >
          <Send aria-hidden />
          Invia in revisione
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
          title={`Anteprima della slide ${index + 1}`}
          sandbox=""
          width={manifest.width}
          height={manifest.height}
          className="origin-top-left border-0"
          style={{ transform: `scale(${scale})` }}
        />
      </div>
      <figcaption className="text-body-sm text-fg-muted">
        {stale
          ? "Anteprima dell'ultimo salvataggio: si aggiorna dopo il salvataggio automatico."
          : `Slide ${index + 1}, come verrà esportata.`}
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
                {c.severity === "error" ? "Blocca" : "Avviso"}
              </Badge>
              <span>{c.message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-sm text-success">Nessun problema.</p>
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
      <h3 className="text-label text-fg">Brand Guard (ultimo salvataggio)</h3>
      {open.length ? (
        <ul className="space-y-2">
          {open.map((f) => (
            <li key={f.key} className="text-body-sm text-fg">
              <Badge variant={f.severity === "error" ? "error" : "warning"}>
                {f.severity === "error" ? "Errore" : "Avviso"}
              </Badge>{" "}
              {f.message}
              {f.suggestion ? (
                <span className="block text-fg-muted">Suggerimento: {f.suggestion}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-sm text-success">Nessuna segnalazione su questa slide.</p>
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
      <h3 className="text-label text-fg">Commenti aperti</h3>
      <ul className="space-y-3">
        {comments.map((c) => (
          <li key={c.id} className="space-y-1 text-body-sm">
            <p className="whitespace-pre-line text-fg">{c.body}</p>
            <p className="text-fg-muted">
              {c.authorName ?? "Utente rimosso"} · {formatDate(c.createdAt)}
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
              Segna come risolto
            </ActionButton>
          </li>
        ))}
      </ul>
    </section>
  );
}
