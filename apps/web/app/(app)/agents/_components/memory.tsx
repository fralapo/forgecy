"use client";

import { Badge, Button, Input, Label, cn } from "@forgecy/ui";
import {
  Archive,
  Check,
  CheckCheck,
  Pencil,
  Plus,
  Save,
  Send,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import type { AdminActionResult } from "../../settings/_lib/admin-action";
import { controlClass } from "../../content/_components/action-button";
import {
  addMemoryAction,
  approveMemoriesAction,
  approveMemoryAction,
  archiveMemoryAction,
  editMemoryAction,
  promoteMemoryAction,
  rejectMemoryAction,
  saveMemorySettingAction,
} from "../memory-actions";

export interface Option {
  value: string;
  label: string;
}

function Message({ result }: { result: AdminActionResult | null }) {
  return (
    <p aria-live="polite" className="min-h-5 text-body-sm">
      {result && !result.ok ? <span className="text-error">{result.error}</span> : null}
      {result?.ok ? <span className="text-success">{result.message}</span> : null}
    </p>
  );
}

/** A modal `<dialog>` opened by `open`, closed by Escape or `onClose`. */
function Modal({
  open,
  onClose,
  labelledBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={labelledBy}
      className="m-auto w-full max-w-md rounded-lg border border-subtle bg-surface p-6 text-fg backdrop:bg-fg/40"
    >
      {children}
    </dialog>
  );
}

export interface MemoryCard {
  id: string;
  href: string;
  content: string;
  status: string;
  statusLabel: string;
  statusVariant: "neutral" | "success" | "warning" | "error" | "info";
  category: string;
  sensitive: boolean;
  meta: string;
  confidence: string;
  version: string;
  selected: boolean;
  /** Non-sensitive candidate at medium or high confidence: can be approved with others. */
  bulk: boolean;
}

/** The memory list, with “Approve selected” for the candidates that allow it. */
export function MemoryList({ items }: { items: MemoryCard[] }) {
  const t = useTranslations("agents.memory");
  const router = useRouter();
  const [chosen, setChosen] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<AdminActionResult | null>(null);
  const [pending, start] = useTransition();
  const bulkable = items.some((i) => i.bulk);
  const picked = items.filter((i) => chosen.includes(i.id));
  return (
    <div className="grid gap-3">
      {bulkable ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            disabled={chosen.length === 0 || pending}
            onClick={() => setOpen(true)}
          >
            <CheckCheck aria-hidden />
            {t("bulk.approve")}
          </Button>
          <span className="text-body-sm text-fg-muted">{t("bulk.hint")}</span>
        </div>
      ) : null}
      <Message result={result} />
      <ul className="grid gap-3">
        {items.map((m) => (
          <li
            key={m.id}
            className={cn(
              "flex gap-3 rounded-lg border bg-surface p-4",
              m.selected ? "border-primary" : "border-subtle",
            )}
          >
            {m.bulk ? (
              <input
                type="checkbox"
                aria-label={t("selectOne")}
                className="mt-1 size-4 shrink-0"
                checked={chosen.includes(m.id)}
                onChange={(e) =>
                  setChosen((prev) =>
                    e.target.checked ? [...prev, m.id] : prev.filter((x) => x !== m.id),
                  )
                }
              />
            ) : null}
            <div className="grid min-w-0 flex-1 gap-2">
              <Link
                href={m.href as Route}
                aria-current={m.selected ? "true" : undefined}
                className="text-body-md text-fg hover:text-link"
              >
                {m.content}
              </Link>
              <div className="flex flex-wrap items-center gap-2 text-body-sm text-fg-muted">
                <Badge variant={m.statusVariant}>{m.statusLabel}</Badge>
                <span className="rounded-sm border border-subtle px-2 py-0.5">{m.category}</span>
                {m.sensitive ? (
                  <Badge variant="warning" icon={ShieldAlert}>
                    {t("sensitive")}
                  </Badge>
                ) : null}
                <span>{m.confidence}</span>
                <span className="font-mono">{m.version}</span>
              </div>
              <p className="text-body-sm text-fg-muted">{m.meta}</p>
            </div>
          </li>
        ))}
      </ul>
      <Modal open={open} onClose={() => setOpen(false)} labelledBy="mem-bulk-title">
        <div className="grid gap-4">
          <h2 id="mem-bulk-title" className="text-heading-sm">
            {t("bulk.title", { count: picked.length })}
          </h2>
          <p className="text-body-md text-fg-muted">{t("bulk.body")}</p>
          <ul className="grid max-h-64 list-disc gap-1 overflow-auto pl-5 text-body-sm">
            {picked.map((m) => (
              <li key={m.id}>{m.content}</li>
            ))}
          </ul>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t("bulk.cancel")}
            </Button>
            <Button
              disabled={pending || picked.length === 0}
              onClick={() =>
                start(async () => {
                  const res = await approveMemoriesAction(picked.map((m) => m.id));
                  setResult(res);
                  setOpen(false);
                  if (res.ok) {
                    setChosen([]);
                    router.refresh();
                  }
                })
              }
            >
              <Check aria-hidden />
              {t("bulk.confirm")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** Actions on the selected memory: approve, reject, edit, propose, archive. */
export function MemoryActions({
  id,
  status,
  lowConfidence,
  content,
  category,
  version,
  categories,
}: {
  id: string;
  status: string;
  lowConfidence: boolean;
  content: string;
  category: string;
  version: number;
  categories: Option[];
}) {
  const t = useTranslations("agents.memory.actions");
  const router = useRouter();
  const [result, setResult] = useState<AdminActionResult | null>(null);
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(content);
  const [cat, setCat] = useState(category);
  const act = (fn: () => Promise<AdminActionResult>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      setResult(res);
      if (res.ok) {
        after?.();
        router.refresh();
      }
    });

  const canEdit = status === "candidate" || status === "approved";
  return (
    <div className="grid gap-4">
      {status === "candidate" ? (
        <div className="grid gap-2">
          <Label htmlFor="mem-note">{t("note")}</Label>
          <textarea
            id="mem-note"
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={controlClass}
            aria-describedby={lowConfidence ? "mem-note-hint" : undefined}
          />
          {lowConfidence ? (
            <p id="mem-note-hint" className="text-body-sm text-fg-muted">
              {t("noteHint")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending || (lowConfidence && note.trim().length < 3)}
              onClick={() =>
                act(
                  () => approveMemoryAction(id, note),
                  () => setNote(""),
                )
              }
            >
              <Check aria-hidden />
              {t("approve")}
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => setRejecting(true)}>
              <X aria-hidden />
              {t("reject")}
            </Button>
          </div>
        </div>
      ) : null}
      {status === "observed" ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending} onClick={() => act(() => promoteMemoryAction(id))}>
            <Send aria-hidden />
            {t("promote")}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={() => setRejecting(true)}>
            <Trash2 aria-hidden />
            {t("reject")}
          </Button>
        </div>
      ) : null}
      {canEdit && !editing ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={pending} onClick={() => setEditing(true)}>
            <Pencil aria-hidden />
            {t("edit")}
          </Button>
          {status === "approved" ? (
            <Button variant="danger" disabled={pending} onClick={() => setArchiving(true)}>
              <Archive aria-hidden />
              {t("archive")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {editing ? (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            act(
              () => editMemoryAction(id, text, cat),
              () => setEditing(false),
            );
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor="mem-edit-category">{t("category")}</Label>
            <select
              id="mem-edit-category"
              value={cat}
              onChange={(e) => setCat(e.target.value)}
              className={controlClass}
            >
              {categories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <textarea
            aria-label={t("content")}
            rows={4}
            maxLength={500}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className={controlClass}
          />
          <p className="text-body-sm text-fg-muted">{t("editHint", { version: version + 1 })}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              <Save aria-hidden />
              {t("save", { version: version + 1 })}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setEditing(false);
                setText(content);
                setCat(category);
              }}
            >
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : null}
      <Message result={result} />
      <Modal open={rejecting} onClose={() => setRejecting(false)} labelledBy="mem-reject-title">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            act(
              () => rejectMemoryAction(id, reason),
              () => {
                setRejecting(false);
                setReason("");
              },
            );
          }}
        >
          <h2 id="mem-reject-title" className="text-heading-sm">
            {t("rejectTitle")}
          </h2>
          <div className="grid gap-1">
            <Label htmlFor="mem-reason">{t("reason")}</Label>
            <textarea
              id="mem-reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={controlClass}
              aria-describedby="mem-reason-hint"
            />
            <p id="mem-reason-hint" className="text-body-sm text-fg-muted">
              {t("reasonHint")}
            </p>
          </div>
          {result && !result.ok ? (
            <p role="alert" className="text-body-sm text-error">
              {result.error}
            </p>
          ) : null}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setRejecting(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" variant="danger" disabled={pending || reason.trim().length < 3}>
              {t("reject")}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal open={archiving} onClose={() => setArchiving(false)} labelledBy="mem-archive-title">
        <div className="grid gap-4">
          <h2 id="mem-archive-title" className="text-heading-sm">
            {t("archiveTitle")}
          </h2>
          <p className="text-body-md text-fg-muted">{t("archiveBody")}</p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setArchiving(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() =>
                act(
                  () => archiveMemoryAction(id),
                  () => setArchiving(false),
                )
              }
            >
              <Archive aria-hidden />
              {t("archive")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** “Add memory”: a person's memory, approved at once. */
export function AddMemoryForm({
  clients,
  clientId,
  agents,
  agent,
  categories,
  max,
}: {
  clients: Option[];
  clientId: string;
  agents: Option[];
  agent: string;
  categories: Option[];
  max: number;
}) {
  const t = useTranslations("agents.memory.addForm");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [client, setClient] = useState(clientId);
  const [who, setWho] = useState(agent);
  const [cat, setCat] = useState(categories[0]?.value ?? "");
  const [text, setText] = useState("");
  const [result, setResult] = useState<AdminActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        {t("title")}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} labelledBy="mem-add-title">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await addMemoryAction({
                clientId: client,
                agent: who,
                category: cat,
                content: text,
              });
              setResult(res);
              if (res.ok) {
                setText("");
                setOpen(false);
                router.refresh();
              }
            });
          }}
        >
          <h2 id="mem-add-title" className="text-heading-sm">
            {t("title")}
          </h2>
          <div className="grid gap-1">
            <Label htmlFor="mem-add-client">{t("client")}</Label>
            <select
              id="mem-add-client"
              value={client}
              onChange={(e) => setClient(e.target.value)}
              className={controlClass}
            >
              <option value="">{t("chooseClient")}</option>
              {clients.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="mem-add-agent">{t("agent")}</Label>
              <select
                id="mem-add-agent"
                value={who}
                onChange={(e) => setWho(e.target.value)}
                className={controlClass}
              >
                {agents.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="mem-add-category">{t("category")}</Label>
              <select
                id="mem-add-category"
                value={cat}
                onChange={(e) => setCat(e.target.value)}
                className={controlClass}
              >
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="mem-add-content">{t("content")}</Label>
            <textarea
              id="mem-add-content"
              rows={3}
              maxLength={max}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className={controlClass}
              aria-describedby="mem-add-hint"
            />
            <p id="mem-add-hint" className="text-body-sm text-fg-muted">
              {t("contentHint", { max })}
            </p>
          </div>
          {result && !result.ok ? (
            <p role="alert" className="text-body-sm text-error">
              {result.error}
            </p>
          ) : null}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending || !client || text.trim().length < 3}>
              <Plus aria-hidden />
              {t("save")}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export interface SettingRow {
  key: "slide_count" | "format" | "language" | "default_cta";
  label: string;
  /** Current value, or null when not set. */
  value: unknown;
  meta: string | null;
}

/** “Structured settings” of a client: one typed editor per value. */
export function MemorySettingsForm({
  clientId,
  rows,
  formats,
  languages,
  ctaKinds,
  slideMin,
  slideMax,
  ctaMax,
}: {
  clientId: string;
  rows: SettingRow[];
  formats: Option[];
  languages: Option[];
  ctaKinds: Option[];
  slideMin: number;
  slideMax: number;
  ctaMax: number;
}) {
  const t = useTranslations("agents.memory.settings");
  return (
    <ul className="grid gap-4">
      {rows.map((r) => (
        <SettingEditor
          key={r.key}
          clientId={clientId}
          row={r}
          formats={formats}
          languages={languages}
          ctaKinds={ctaKinds}
          slideMin={slideMin}
          slideMax={slideMax}
          ctaMax={ctaMax}
          notSet={t("notSet")}
        />
      ))}
    </ul>
  );
}

function SettingEditor({
  clientId,
  row,
  formats,
  languages,
  ctaKinds,
  slideMin,
  slideMax,
  ctaMax,
  notSet,
}: {
  clientId: string;
  row: SettingRow;
  formats: Option[];
  languages: Option[];
  ctaKinds: Option[];
  slideMin: number;
  slideMax: number;
  ctaMax: number;
  notSet: string;
}) {
  const t = useTranslations("agents.memory.settings");
  const router = useRouter();
  const [result, setResult] = useState<AdminActionResult | null>(null);
  const [pending, start] = useTransition();
  const cta = (row.value ?? null) as { text: string; kind: string } | null;
  const [value, setValue] = useState(
    row.key === "default_cta" ? (cta?.text ?? "") : row.value == null ? "" : String(row.value),
  );
  const [kind, setKind] = useState(cta?.kind ?? ctaKinds[0]?.value ?? "");
  const save = (next: unknown) =>
    start(async () => {
      const res = await saveMemorySettingAction(clientId, row.key, next);
      setResult(res);
      if (res.ok) router.refresh();
    });
  const id = `mem-set-${row.key}`;
  const options = row.key === "format" ? formats : row.key === "language" ? languages : [];
  const typed = (): unknown =>
    row.key === "slide_count"
      ? Number(value)
      : row.key === "default_cta"
        ? { text: value, kind }
        : value;
  return (
    <li className="grid gap-2 border-b border-subtle pb-4 last:border-b-0">
      <form
        className="grid items-center gap-3 sm:grid-cols-[12rem_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          save(typed());
        }}
      >
        <Label htmlFor={id}>{row.label}</Label>
        {row.key === "slide_count" ? (
          <Input
            id={id}
            type="number"
            min={slideMin}
            max={slideMax}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-describedby={`${id}-hint`}
          />
        ) : row.key === "default_cta" ? (
          <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
            <Input
              id={id}
              value={value}
              maxLength={ctaMax}
              onChange={(e) => setValue(e.target.value)}
              aria-describedby={`${id}-hint`}
            />
            <select
              aria-label={t("ctaKind")}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className={controlClass}
            >
              {ctaKinds.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <select
            id={id}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={controlClass}
          >
            <option value="">{t("choose")}</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        <div className="flex gap-2">
          <Button type="submit" variant="secondary" disabled={pending || value === ""}>
            <Save aria-hidden />
            {t("save")}
          </Button>
          {row.value != null ? (
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setValue("");
                save(null);
              }}
            >
              {t("clear")}
            </Button>
          ) : null}
        </div>
      </form>
      <p id={`${id}-hint`} className="text-body-sm text-fg-muted">
        {row.meta ?? notSet}
        {row.key === "slide_count"
          ? ` · ${t("rangeHint", { min: slideMin, max: slideMax })}`
          : null}
        {row.key === "default_cta" ? ` · ${t("ctaHint", { max: ctaMax })}` : null}
      </p>
      <Message result={result} />
    </li>
  );
}
