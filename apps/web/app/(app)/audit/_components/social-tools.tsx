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
  ignore: "Ignora",
  date: "Data",
  post_type: "Tipo di post",
  format: "Formato",
  text: "Testo",
  views: "Visualizzazioni",
  reach: "Copertura",
  interactions: "Interazioni",
  likes: "Mi piace / reazioni",
  comments: "Commenti",
  saves: "Salvataggi",
  shares: "Condivisioni",
  followers: "Follower",
  impressions: "Impressioni",
  clicks: "Clic",
  ctr: "CTR",
  followers_gained: "Follower acquisiti",
  followers_lost: "Follower persi",
  page_visits: "Visite alla pagina",
  leads: "Lead",
};

const sourceLabel: Record<MetricSource, string> = {
  provided_by_prospect: "Fornito dal prospect",
  agency_tool: "Strumento dell'agenzia",
  public_profile: "Letto dal profilo pubblico",
  file_import: "File importato",
  other: "Altro (descrivi)",
};

async function upload(
  form: FormData,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const res = await fetch("/audit/upload", { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok)
    return { ok: false, error: String(body.message ?? body.error ?? "Caricamento non riuscito") };
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
          setMessage({ ok: `${String(res.data.added)} screenshot caricati.` });
          el.reset();
          router.refresh();
        });
      }}
    >
      <Label htmlFor={`shots-${channel}`}>Screenshot del profilo e dei post</Label>
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
        PNG, JPEG o WebP, massimo 20 MB l&apos;uno e 60 per canale. L&apos;AI li usa per stile, tono
        e call to action; i numeri che leggi li inserisci qui sotto con la fonte.
      </p>
      <div>
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          <ImageUp aria-hidden />
          Carica screenshot
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
        <Label htmlFor={`table-${channel}`}>Export dei post (CSV o XLSX)</Label>
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
            Carica e mappa le colonne
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
              Riprendi il file caricato
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
        <strong>{preview.fileName}</strong> · {preview.totalRows} righe
      </p>
      <div className="flex flex-wrap gap-4">
        {preview.sheets.length > 1 ? (
          <label className="flex flex-col gap-1 text-label text-fg-muted">
            Foglio
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
          Formato data
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
            <option value="dd/mm/yyyy">gg/mm/aaaa</option>
            <option value="mm/dd/yyyy">mm/gg/aaaa</option>
            <option value="yyyy-mm-dd">aaaa-mm-gg</option>
          </select>
        </label>
      </div>
      <div className="overflow-x-auto rounded-md border border-subtle">
        <table className="w-full text-left text-body-sm">
          <caption className="sr-only">Mappatura delle colonne e prime righe</caption>
          <thead>
            <tr className="border-b border-subtle">
              {preview.headers.map((h, i) => (
                <th
                  key={`${h}-${i}`}
                  scope="col"
                  className="min-w-40 px-3 py-2 align-top font-medium"
                >
                  <span className="block truncate">{h || `Colonna ${i + 1}`}</span>
                  <select
                    aria-label={`Campo per la colonna ${h || i + 1}`}
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
            {preview.validRows} righe valide
            {preview.invalid.length
              ? ` · ${preview.invalid.length} saltate (es. riga ${preview.invalid[0]!.rowNumber}: ${preview.invalid[0]!.reason})`
              : ""}
            . I numeri non esatti (intervalli, “circa”) restano vuoti, non stimati.
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
              setDone(`Importate ${res.data?.imported ?? 0} righe.`);
              router.refresh();
            })
          }
        >
          Importa {preview.validRows} righe
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
          Annulla
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
        <Label htmlFor={`metric-${channel}`}>Valore</Label>
        <select id={`metric-${channel}`} name="metric" className={selectClass}>
          {metrics.map((m) => (
            <option key={m} value={m}>
              {metricLabel[m] ?? m}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`value-${channel}`}>Numero esatto</Label>
        <Input
          id={`value-${channel}`}
          name="value"
          inputMode="decimal"
          required
          placeholder="1.240"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`date-${channel}`}>Rilevato il</Label>
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
        <Label htmlFor={`source-${channel}`}>Fonte</Label>
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
          Nota sulla fonte{source === "other" ? "" : " (facoltativa)"}
        </Label>
        <Input
          id={`note-${channel}`}
          name="sourceNote"
          maxLength={200}
          required={source === "other"}
          placeholder="Es. screenshot del 3 ottobre, Meta Business Suite"
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
          Aggiungi valore
        </Button>
      </div>
    </form>
  );
}

/** Profile link, "Dati non disponibili" (with reason) or "Salta canale". */
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
      if (!res.ok) return setError(res.error ?? "Operazione non riuscita");
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
          Link al profilo (non viene aperto da Forgecy)
          <Input name="profileUrl" inputMode="url" defaultValue={profileUrl ?? ""} />
        </label>
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          Salva link
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
            Riapri il canale
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
            Perché i dati non sono disponibili?
            <Input
              name="reason"
              required
              maxLength={200}
              placeholder="Es. il prospect non ha dato accesso"
            />
          </label>
          <Button type="submit" size="sm" disabled={pending}>
            Conferma
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setMode("view")}>
            Annulla
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
            Dati non disponibili
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() =>
              run(() => setChannelUnavailableAction({ auditId, channel, mode: "skipped" }))
            }
          >
            Salta canale
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
