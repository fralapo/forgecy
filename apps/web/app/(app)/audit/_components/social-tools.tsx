"use client";

import {
  channelMetrics,
  metricSources,
  socialPostFields,
  type MetricSource,
  type SocialChannel,
} from "@forgecy/core";
import { Button, Input, Label } from "@forgecy/ui";
import { FileSpreadsheet, ImageUp, Plus, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addMetricAction,
  importTableAction,
  previewTableAction,
  reopenChannelAction,
  setChannelProfileAction,
  setChannelUnavailableAction,
} from "../actions";
import { metricLabel } from "../_lib/labels";
import { selectClass } from "../_lib/styles";

type DateFormat = "dd/mm/yyyy" | "mm/dd/yyyy" | "yyyy-mm-dd";

interface Preview {
  sourceId: string;
  fileName: string;
  sheets: string[];
  sheet?: string;
  headers: string[];
  mapping: Record<number, string>;
  dateFormat: DateFormat;
  sample: string[][];
  totalRows: number;
  validRows: number;
  invalid: Array<{ rowNumber: number; reason: string }>;
  error?: string;
}

const fieldLabel: Record<string, string> = {
  ignore: "Ignore",
  date: "Date",
  post_type: "Post type",
  format: "Format",
  text: "Text",
  views: "Views",
  reach: "Reach",
  interactions: "Interactions",
  likes: "Likes / reactions",
  comments: "Comments",
  saves: "Saves",
  shares: "Shares",
  followers: "Followers",
  impressions: "Impressions",
  clicks: "Clicks",
  ctr: "CTR",
  followers_gained: "Followers gained",
  followers_lost: "Followers lost",
  page_visits: "Page visits",
  leads: "Leads",
};

const sourceLabel: Record<MetricSource, string> = {
  provided_by_prospect: "Provided by the prospect",
  agency_tool: "Agency tool",
  public_profile: "Read from the public profile",
  file_import: "Imported file",
  other: "Other (describe)",
};

async function upload(
  form: FormData,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const res = await fetch("/audit/upload", { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return { ok: false, error: String(body.message ?? body.error ?? "Upload failed") };
  return { ok: true, data: body };
}

/** Screenshots of the profile: stored as evidence, never read automatically. */
export function ScreenshotUpload({
  auditId,
  channel,
}: {
  auditId: string;
  channel: SocialChannel;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ error?: string; ok?: string }>({});
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        form.set("auditId", auditId);
        form.set("channel", channel);
        form.set("kind", "screenshots");
        const el = e.currentTarget;
        start(async () => {
          const res = await upload(form);
          if (!res.ok) return setMessage({ error: res.error });
          setMessage({ ok: `${String(res.data.added)} screenshots uploaded.` });
          el.reset();
          router.refresh();
        });
      }}
    >
      <Label htmlFor={`shots-${channel}`}>Screenshots of the profile and posts</Label>
      <input
        id={`shots-${channel}`}
        name="files"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        required
        className="text-body-sm"
      />
      <p className="text-body-sm text-fg-muted">
        PNG, JPEG or WebP, up to 20 MB each and 60 per channel. The AI uses them for style, tone and
        calls to action; enter the numbers you read below, with their source.
      </p>
      <div>
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          <ImageUp aria-hidden />
          Upload screenshots
        </Button>
      </div>
      {message.error ? (
        <p role="alert" className="text-body-sm text-error">
          {message.error}
        </p>
      ) : message.ok ? (
        <p role="status" className="text-body-sm text-success">
          {message.ok}
        </p>
      ) : null}
    </form>
  );
}

/** CSV/XLSX export: upload, map the columns, check the preview, import. */
export function TableImport({
  auditId,
  channel,
  pendingSourceId,
}: {
  auditId: string;
  channel: SocialChannel;
  /** A file uploaded earlier and not imported yet. */
  pendingSourceId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = (input: Parameters<typeof previewTableAction>[0]) =>
    start(async () => {
      setError(null);
      const res = await previewTableAction(input);
      if (!res.ok) return setError(res.error);
      setPreview(res.data as Preview);
    });

  if (!preview)
    return (
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          form.set("auditId", auditId);
          form.set("channel", channel);
          form.set("kind", "table");
          start(async () => {
            setError(null);
            setDone(null);
            const res = await upload(form);
            if (!res.ok) return setError(res.error);
            load({ sourceId: String(res.data.sourceId) });
          });
        }}
      >
        <Label htmlFor={`table-${channel}`}>Post export (CSV or XLSX)</Label>
        <input
          id={`table-${channel}`}
          name="files"
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
          className="text-body-sm"
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="secondary" size="sm" disabled={pending}>
            <Upload aria-hidden />
            Upload and map the columns
          </Button>
          {pendingSourceId ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => load({ sourceId: pendingSourceId })}
            >
              <FileSpreadsheet aria-hidden />
              Resume the uploaded file
            </Button>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-body-sm text-error">
            {error}
          </p>
        ) : done ? (
          <p role="status" className="text-body-sm text-success">
            {done}
          </p>
        ) : null}
      </form>
    );

  const setMapping = (col: number, field: string) =>
    load({
      sourceId: preview.sourceId,
      ...(preview.sheet ? { sheet: preview.sheet } : {}),
      dateFormat: preview.dateFormat,
      mapping: Object.fromEntries(
        Object.entries({ ...preview.mapping, [col]: field }).map(([k, v]) => [k, v]),
      ),
    });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body-sm text-fg">
        <strong>{preview.fileName}</strong> · {preview.totalRows} rows
      </p>
      <div className="flex flex-wrap gap-4">
        {preview.sheets.length > 1 ? (
          <label className="flex flex-col gap-1 text-label text-fg-muted">
            Sheet
            <select
              className={selectClass}
              value={preview.sheet}
              onChange={(e) => load({ sourceId: preview.sourceId, sheet: e.target.value })}
            >
              {preview.sheets.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-label text-fg-muted">
          Date format
          <select
            className={selectClass}
            value={preview.dateFormat}
            onChange={(e) =>
              load({
                sourceId: preview.sourceId,
                ...(preview.sheet ? { sheet: preview.sheet } : {}),
                mapping: Object.fromEntries(Object.entries(preview.mapping)),
                dateFormat: e.target.value as DateFormat,
              })
            }
          >
            <option value="dd/mm/yyyy">dd/mm/yyyy</option>
            <option value="mm/dd/yyyy">mm/dd/yyyy</option>
            <option value="yyyy-mm-dd">yyyy-mm-dd</option>
          </select>
        </label>
      </div>
      <div className="overflow-x-auto rounded-md border border-subtle">
        <table className="w-full text-left text-body-sm">
          <caption className="sr-only">Column mapping and first rows</caption>
          <thead>
            <tr className="border-b border-subtle">
              {preview.headers.map((h, i) => (
                <th
                  key={`${h}-${i}`}
                  scope="col"
                  className="min-w-40 px-3 py-2 align-top font-medium"
                >
                  <span className="block truncate">{h || `Column ${i + 1}`}</span>
                  <select
                    aria-label={`Field for column ${h || i + 1}`}
                    className={`${selectClass} mt-1 h-8`}
                    value={preview.mapping[i] ?? "ignore"}
                    disabled={pending}
                    onChange={(e) => setMapping(i, e.target.value)}
                  >
                    {["ignore", ...socialPostFields].map((f) => (
                      <option key={f} value={f}>
                        {fieldLabel[f] ?? f}
                      </option>
                    ))}
                  </select>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.sample.map((row, r) => (
              <tr key={r} className="border-b border-subtle last:border-0">
                {preview.headers.map((_, i) => (
                  <td key={i} className="max-w-56 truncate px-3 py-2 text-fg-muted">
                    {row[i] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-body-sm">
        {preview.error ? (
          <span className="text-error">{preview.error}</span>
        ) : (
          <>
            {preview.validRows} valid rows
            {preview.invalid.length
              ? ` · ${preview.invalid.length} skipped (e.g. row ${preview.invalid[0]!.rowNumber}: ${preview.invalid[0]!.reason})`
              : ""}
            . Inexact numbers (ranges, “about”) stay empty, never estimated.
          </>
        )}
      </p>
      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={pending || Boolean(preview.error) || preview.validRows === 0}
          onClick={() =>
            start(async () => {
              const res = await importTableAction({
                sourceId: preview.sourceId,
                ...(preview.sheet ? { sheet: preview.sheet } : {}),
                mapping: Object.fromEntries(Object.entries(preview.mapping)),
                dateFormat: preview.dateFormat,
              });
              if (!res.ok) return setError(res.error);
              setPreview(null);
              setDone(`Imported ${res.data?.imported ?? 0} rows.`);
              router.refresh();
            })
          }
        >
          Import {preview.validRows} rows
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** A value typed by a person: exact number, date and source are required. */
export function MetricForm({ auditId, channel }: { auditId: string; channel: SocialChannel }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<MetricSource>("public_profile");
  const today = new Date().toISOString().slice(0, 10);
  const metrics =
    channel === "linkedin"
      ? channelMetrics.filter((m) => !["avg_views", "avg_likes", "posts_total"].includes(m))
      : channel === "tiktok"
        ? channelMetrics.filter((m) =>
            ["followers", "posts_total", "avg_views", "avg_likes"].includes(m),
          )
        : channelMetrics.filter((m) => ["followers", "posts_total"].includes(m));
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const v = (k: string) => String(f.get(k) ?? "").trim();
        const el = e.currentTarget;
        start(async () => {
          setError(null);
          const res = await addMetricAction({
            auditId,
            channel,
            metric: v("metric") as (typeof channelMetrics)[number],
            value: v("value"),
            observedOn: v("observedOn"),
            source,
            ...(v("sourceNote") ? { sourceNote: v("sourceNote") } : {}),
          });
          if (!res.ok) return setError(res.error);
          el.reset();
          router.refresh();
        });
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor={`metric-${channel}`}>Metric</Label>
        <select id={`metric-${channel}`} name="metric" className={selectClass}>
          {metrics.map((m) => (
            <option key={m} value={m}>
              {metricLabel[m] ?? m}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`value-${channel}`}>Exact number</Label>
        <Input
          id={`value-${channel}`}
          name="value"
          inputMode="decimal"
          required
          placeholder="1,240"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`date-${channel}`}>Observed on</Label>
        <Input
          id={`date-${channel}`}
          name="observedOn"
          type="date"
          required
          max={today}
          defaultValue={today}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`source-${channel}`}>Source</Label>
        <select
          id={`source-${channel}`}
          className={selectClass}
          value={source}
          onChange={(e) => setSource(e.target.value as MetricSource)}
        >
          {metricSources
            .filter((s) => s !== "file_import")
            .map((s) => (
              <option key={s} value={s}>
                {sourceLabel[s]}
              </option>
            ))}
        </select>
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <Label htmlFor={`note-${channel}`}>
          Source note{source === "other" ? "" : " (optional)"}
        </Label>
        <Input
          id={`note-${channel}`}
          name="sourceNote"
          maxLength={200}
          required={source === "other"}
          placeholder="E.g. screenshot from 3 October, Meta Business Suite"
        />
      </div>
      {error ? (
        <p role="alert" className="text-body-sm text-error sm:col-span-2">
          {error}
        </p>
      ) : null}
      <div className="sm:col-span-2">
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          <Plus aria-hidden />
          Add value
        </Button>
      </div>
    </form>
  );
}

/** Profile link, "Data unavailable" (with reason) or "Skip channel". */
export function ChannelSettings({
  auditId,
  channel,
  profileUrl,
  status,
}: {
  auditId: string;
  channel: SocialChannel;
  profileUrl: string | null;
  status: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "unavailable">("view");
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) return setError(res.error ?? "Operation failed");
      setMode("view");
      router.refresh();
    });
  const closed = status === "unavailable" || status === "skipped";
  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const url = String(new FormData(e.currentTarget).get("profileUrl") ?? "").trim();
          run(() => setChannelProfileAction(auditId, channel, url || undefined));
        }}
      >
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-label text-fg-muted">
          Profile link (Forgecy does not open it)
          <Input name="profileUrl" inputMode="url" defaultValue={profileUrl ?? ""} />
        </label>
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          Save link
        </Button>
      </form>
      {closed ? (
        <div>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => run(() => reopenChannelAction(auditId, channel))}
          >
            Reopen channel
          </Button>
        </div>
      ) : mode === "unavailable" ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
            run(() =>
              setChannelUnavailableAction({ auditId, channel, mode: "unavailable", reason }),
            );
          }}
        >
          <label className="flex min-w-64 flex-1 flex-col gap-1 text-label text-fg-muted">
            Why is the data unavailable?
            <Input
              name="reason"
              required
              maxLength={200}
              placeholder="E.g. the prospect did not grant access"
            />
          </label>
          <Button type="submit" size="sm" disabled={pending}>
            Confirm
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setMode("view")}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => setMode("unavailable")}
          >
            Data unavailable
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() =>
              run(() => setChannelUnavailableAction({ auditId, channel, mode: "skipped" }))
            }
          >
            Skip channel
          </Button>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
