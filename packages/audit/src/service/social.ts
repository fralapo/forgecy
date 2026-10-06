import {
  assertCan,
  AUDIT_LIMITS,
  channelMetrics,
  ForgecyError,
  metricSources,
  socialChannels,
  socialPostFields,
  USABLE_FINDING_STATUSES,
  type Actor,
  type AuditEvidence,
  type SocialChannel,
} from "@forgecy/core";
import {
  and,
  auditChannelStates,
  auditFindings,
  auditMetrics,
  auditSocialPosts,
  auditSources,
  eq,
  ne,
  recordAuditEvent,
  sql,
  type Database,
} from "@forgecy/db";
import { assertValidUpload, contentKey, sha256 } from "@forgecy/files";
import type { Readable } from "node:stream";
import { z } from "zod";
import { auditAnalyzeSocialJob } from "../jobs";
import {
  dateFormats,
  interpretRows,
  parseStrictNumber,
  readTable,
  suggestMapping,
  type ColumnMapping,
  type DateFormat,
} from "../social/table";
import { isPlatformUrl, normalizeSiteUrl } from "../url";
import {
  assertAiAllowed,
  assertEditable,
  enqueueAuditJob,
  hasActiveJob,
  loadAudit,
  requireStorage,
  userIdOf,
  type AuditDeps,
} from "./common";
import { channelLabel } from "./prospects";

export interface UploadedFile {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

async function editableAudit(deps: AuditDeps, actor: Actor, auditId: string) {
  const loaded = await loadAudit(deps.db, auditId);
  assertCan(actor, "project.edit", loaded.audit.clientId);
  assertEditable(loaded.audit);
  return loaded;
}

async function upsertChannel(
  db: Pick<Database, "insert">,
  values: typeof auditChannelStates.$inferInsert,
): Promise<void> {
  await db
    .insert(auditChannelStates)
    .values(values)
    .onConflictDoUpdate({
      target: [auditChannelStates.auditId, auditChannelStates.channel],
      set: {
        ...(values.profileUrl !== undefined ? { profileUrl: values.profileUrl } : {}),
        status: values.status,
        unavailableReason: values.unavailableReason ?? null,
        updatedBy: values.updatedBy ?? null,
        updatedAt: new Date(),
      },
    });
}

/** Add a social channel or change its profile link (never opened by Forgecy). */
export async function setChannelProfile(
  deps: AuditDeps,
  actor: Actor,
  input: { auditId: string; channel: SocialChannel; profileUrl?: string },
) {
  await editableAudit(deps, actor, input.auditId);
  let profileUrl: string | null = null;
  if (input.profileUrl?.trim()) {
    profileUrl = normalizeSiteUrl(input.profileUrl);
    if (!profileUrl || !isPlatformUrl(input.channel, profileUrl))
      throw new ForgecyError(
        "validation",
        `Il link non è un profilo ${channelLabel[input.channel]}`,
      );
  }
  const existing = await deps.db.query.auditChannelStates.findFirst({
    where: and(
      eq(auditChannelStates.auditId, input.auditId),
      eq(auditChannelStates.channel, input.channel),
    ),
  });
  await upsertChannel(deps.db, {
    auditId: input.auditId,
    channel: input.channel,
    profileUrl,
    status:
      existing && existing.status !== "unavailable" && existing.status !== "skipped"
        ? existing.status
        : "pending",
    updatedBy: userIdOf(actor),
  });
}

/** "Dati non disponibili" (with the reason) or "Salta canale". The report says so. */
export async function setChannelUnavailable(
  deps: AuditDeps,
  actor: Actor,
  input: {
    auditId: string;
    channel: SocialChannel;
    mode: "unavailable" | "skipped";
    reason?: string;
  },
) {
  const { audit } = await editableAudit(deps, actor, input.auditId);
  const reason = input.reason?.trim();
  if (input.mode === "unavailable" && !reason)
    throw new ForgecyError("validation", "Scrivi perché i dati non sono disponibili.");
  await upsertChannel(deps.db, {
    auditId: input.auditId,
    channel: input.channel,
    status: input.mode,
    unavailableReason: reason ?? (input.mode === "skipped" ? "Canale saltato" : null),
    updatedBy: userIdOf(actor),
  });
  await recordAuditEvent(deps.db, {
    actor,
    action: `audit.channel.${input.mode}`,
    entity: "audit",
    entityId: input.auditId,
    clientId: audit.clientId,
    meta: { channel: input.channel },
  });
}

/** Back to "Da raccogliere" after marking a channel unavailable or skipped. */
export async function reopenChannel(
  deps: AuditDeps,
  actor: Actor,
  input: { auditId: string; channel: SocialChannel },
) {
  await editableAudit(deps, actor, input.auditId);
  const hasData = await channelHasData(deps.db, input.auditId, input.channel);
  await upsertChannel(deps.db, {
    auditId: input.auditId,
    channel: input.channel,
    status: hasData ? "collected" : "pending",
    updatedBy: userIdOf(actor),
  });
}

async function channelHasData(db: Database, auditId: string, channel: SocialChannel) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditSources)
    .where(
      and(
        eq(auditSources.auditId, auditId),
        eq(auditSources.channel, channel),
        eq(auditSources.status, "collected"),
      ),
    );
  const [metric] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditMetrics)
    .where(and(eq(auditMetrics.auditId, auditId), eq(auditMetrics.channel, channel)));
  return (row?.n ?? 0) + (metric?.n ?? 0) > 0;
}

async function markCollected(
  db: Database,
  auditId: string,
  channel: SocialChannel,
  userId: string | null,
) {
  await upsertChannel(db, { auditId, channel, status: "collected", updatedBy: userId });
}

/**
 * Screenshots of a profile, stored as evidence. Nobody reads them automatically:
 * values seen in them are typed by a person with their source.
 */
export async function uploadScreenshots(
  deps: AuditDeps,
  actor: Actor,
  input: { auditId: string; channel: SocialChannel; files: UploadedFile[] },
): Promise<{ added: number }> {
  const { audit } = await loadAudit(deps.db, input.auditId);
  assertCan(actor, "assets.upload", audit.clientId);
  assertCan(actor, "project.edit", audit.clientId);
  assertEditable(audit);
  const storage = requireStorage(deps);
  if (!input.files.length) throw new ForgecyError("validation", "Scegli almeno un'immagine.");
  const [count] = await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditSources)
    .where(
      and(
        eq(auditSources.auditId, input.auditId),
        eq(auditSources.channel, input.channel),
        eq(auditSources.kind, "screenshot"),
      ),
    );
  if ((count?.n ?? 0) + input.files.length > AUDIT_LIMITS.maxScreenshotsPerChannel)
    throw new ForgecyError(
      "validation",
      `Al massimo ${AUDIT_LIMITS.maxScreenshotsPerChannel} screenshot per canale.`,
    );
  const checked = input.files.map((f) => ({
    file: f,
    type: assertValidUpload({
      kind: "image",
      mime: f.mime,
      size: f.bytes.byteLength,
      firstBytes: f.bytes.subarray(0, 1024),
    }),
    hash: sha256(f.bytes),
  }));
  const userId = userIdOf(actor);
  for (const c of checked) {
    const key = contentKey({
      clientId: audit.clientId,
      scope: "audit/social",
      sha256: c.hash,
      ext: c.type.ext,
    });
    await storage.put(key, c.file.bytes, { contentType: c.type.mime });
    await deps.db.insert(auditSources).values({
      auditId: input.auditId,
      channel: input.channel,
      kind: "screenshot",
      method: "screenshot",
      providedBy: "upload",
      status: "collected",
      title: c.file.name.slice(0, 200),
      storageKey: key,
      fileName: c.file.name.slice(0, 200),
      mime: c.type.mime,
      size: c.file.bytes.byteLength,
      sha256: c.hash,
      createdBy: userId,
    });
  }
  await markCollected(deps.db, input.auditId, input.channel, userId);
  await recordAuditEvent(deps.db, {
    actor,
    action: "audit.social.screenshots",
    entity: "audit",
    entityId: input.auditId,
    clientId: audit.clientId,
    meta: { channel: input.channel, files: checked.length },
  });
  return { added: checked.length };
}

export async function readAll(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return new Uint8Array(Buffer.concat(chunks));
}

function tableKind(mime: string, ext: string): "csv" | "xlsx" {
  if (ext === "xlsx") return "xlsx";
  if (ext === "csv" || ext === "txt" || mime.startsWith("text/")) return "csv";
  throw new ForgecyError("validation", "Carica un file CSV o XLSX.");
}

/** Upload a CSV/XLSX export; nothing is imported until the mapping is confirmed. */
export async function uploadTable(
  deps: AuditDeps,
  actor: Actor,
  input: { auditId: string; channel: SocialChannel; file: UploadedFile },
): Promise<{ sourceId: string }> {
  const { audit } = await loadAudit(deps.db, input.auditId);
  assertCan(actor, "assets.upload", audit.clientId);
  assertCan(actor, "project.edit", audit.clientId);
  assertEditable(audit);
  const storage = requireStorage(deps);
  const name = input.file.name.toLowerCase();
  const declared = name.endsWith(".csv")
    ? "text/csv"
    : name.endsWith(".xlsx")
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : input.file.mime;
  const type = assertValidUpload({
    kind: "document",
    mime: declared,
    size: input.file.bytes.byteLength,
    firstBytes: input.file.bytes.subarray(0, 1024),
  });
  const kind = tableKind(type.mime, type.ext);
  const table = await readTable(input.file.bytes, kind);
  const hash = sha256(input.file.bytes);
  const key = contentKey({
    clientId: audit.clientId,
    scope: "audit/imports",
    sha256: hash,
    ext: kind,
  });
  await storage.put(key, input.file.bytes, { contentType: type.mime });
  const [row] = await deps.db
    .insert(auditSources)
    .values({
      auditId: input.auditId,
      channel: input.channel,
      kind: "file",
      method: "manual_import",
      providedBy: "upload",
      status: "pending",
      title: input.file.name.slice(0, 200),
      storageKey: key,
      fileName: input.file.name.slice(0, 200),
      mime: type.mime,
      size: input.file.bytes.byteLength,
      sha256: hash,
      data: { headers: table.headers, ...(table.sheet ? { sheet: table.sheet } : {}) },
      createdBy: userIdOf(actor),
    })
    .returning({ id: auditSources.id });
  return { sourceId: row!.id };
}

async function loadTableSource(deps: AuditDeps, sourceId: string) {
  const [source] = await deps.db.select().from(auditSources).where(eq(auditSources.id, sourceId));
  if (!source || source.kind !== "file" || !source.storageKey)
    throw new ForgecyError("not_found", "File non trovato");
  const bytes = await readAll(await requireStorage(deps).get(source.storageKey));
  const kind = source.storageKey.endsWith(".xlsx") ? "xlsx" : "csv";
  return { source, bytes, kind } as const;
}

export const mappingSchema = z.record(
  z.string().regex(/^\d+$/),
  z.union([z.enum(socialPostFields), z.literal("ignore")]),
);

export interface TablePreview {
  sourceId: string;
  fileName: string;
  sheets: string[];
  sheet?: string;
  headers: string[];
  mapping: ColumnMapping;
  dateFormat: DateFormat;
  sample: string[][];
  totalRows: number;
  validRows: number;
  invalid: Array<{ rowNumber: number; reason: string }>;
  error?: string;
}

/** Preview of the mapping (Page 8): first rows, valid and skipped counts. */
export async function previewTable(
  deps: AuditDeps,
  input: {
    sourceId: string;
    sheet?: string;
    mapping?: Record<string, string>;
    dateFormat?: DateFormat;
  },
): Promise<TablePreview> {
  const { source, bytes, kind } = await loadTableSource(deps, input.sourceId);
  const table = await readTable(bytes, kind, input.sheet);
  const mapping: ColumnMapping = input.mapping
    ? (Object.fromEntries(
        Object.entries(mappingSchema.parse(input.mapping)).map(([k, v]) => [Number(k), v]),
      ) as ColumnMapping)
    : suggestMapping(table.headers);
  const dateFormat = input.dateFormat ?? "dd/mm/yyyy";
  let validRows = 0;
  let invalid: TablePreview["invalid"] = [];
  let error: string | undefined;
  try {
    const result = interpretRows(table, mapping, dateFormat);
    validRows = result.rows.length;
    invalid = result.invalid;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  return {
    sourceId: source.id,
    fileName: source.fileName ?? "file",
    sheets: table.sheets,
    ...(table.sheet ? { sheet: table.sheet } : {}),
    headers: table.headers,
    mapping,
    dateFormat,
    sample: table.rows.slice(0, 5),
    totalRows: table.rows.length,
    validRows,
    invalid: invalid.slice(0, 50),
    ...(error ? { error } : {}),
  };
}

/** Import the rows with the confirmed mapping. Re-importing the same file replaces its rows. */
export async function importTable(
  deps: AuditDeps,
  actor: Actor,
  input: {
    sourceId: string;
    sheet?: string;
    mapping: Record<string, string>;
    dateFormat: DateFormat;
  },
): Promise<{ imported: number; skipped: number }> {
  const { source, bytes, kind } = await loadTableSource(deps, input.sourceId);
  const { audit } = await editableAudit(deps, actor, source.auditId);
  if (!dateFormats.includes(input.dateFormat))
    throw new ForgecyError("validation", "Formato data non valido");
  const table = await readTable(bytes, kind, input.sheet);
  const mapping = Object.fromEntries(
    Object.entries(mappingSchema.parse(input.mapping)).map(([k, v]) => [Number(k), v]),
  ) as ColumnMapping;
  const { rows, invalid } = interpretRows(table, mapping, input.dateFormat);
  if (!rows.length)
    throw new ForgecyError(
      "validation",
      "Nessuna riga valida: controlla la colonna della data e il formato.",
    );
  const channel = source.channel as SocialChannel;
  const userId = userIdOf(actor);
  await deps.db.transaction(async (tx) => {
    await tx.delete(auditSocialPosts).where(eq(auditSocialPosts.sourceId, source.id));
    await tx.delete(auditMetrics).where(eq(auditMetrics.sourceId, source.id));
    for (let i = 0; i < rows.length; i += 500) {
      await tx.insert(auditSocialPosts).values(
        rows.slice(i, i + 500).map((r) => ({
          auditId: source.auditId,
          channel,
          sourceId: source.id,
          rowNumber: r.rowNumber,
          postedOn: r.postedOn,
          postType: r.postType ?? null,
          format: r.format ?? null,
          text: r.text ?? null,
          metrics: r.metrics,
        })),
      );
    }
    // A followers column becomes one dated metric (latest row), from the same file.
    const withFollowers = rows
      .filter((r) => r.metrics.followers !== undefined)
      .sort((a, b) => b.postedOn.localeCompare(a.postedOn))[0];
    if (withFollowers)
      await tx.insert(auditMetrics).values({
        auditId: source.auditId,
        channel,
        metric: "followers",
        value: withFollowers.metrics.followers!,
        observedOn: withFollowers.postedOn,
        source: "file_import",
        sourceNote: source.fileName,
        sourceId: source.id,
        createdBy: userId,
      });
    await tx
      .update(auditSources)
      .set({
        status: "collected",
        data: {
          ...source.data,
          ...(table.sheet ? { sheet: table.sheet } : {}),
          headers: table.headers,
          mapping: Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, v])),
          dateFormat: input.dateFormat,
          rowsImported: rows.length,
          rowsSkipped: invalid.length,
        },
      })
      .where(eq(auditSources.id, source.id));
    await upsertChannel(tx, {
      auditId: source.auditId,
      channel,
      status: "collected",
      updatedBy: userId,
    });
    await recordAuditEvent(tx, {
      actor,
      action: "audit.social.import",
      entity: "audit",
      entityId: source.auditId,
      clientId: audit.clientId,
      meta: { channel, rows: rows.length, skipped: invalid.length },
    });
  });
  return { imported: rows.length, skipped: invalid.length };
}

export const metricInputSchema = z
  .object({
    auditId: z.uuid(),
    channel: z.enum(socialChannels),
    metric: z.enum(channelMetrics),
    value: z.string().trim().min(1, "Scrivi il valore"),
    observedOn: z.iso.date("Data non valida"),
    source: z.enum(metricSources, "Indica da dove viene il valore"),
    sourceNote: z.string().trim().max(200).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.source === "other" && !v.sourceNote)
      ctx.addIssue({ code: "custom", path: ["sourceNote"], message: "Descrivi la fonte" });
    if (v.observedOn > new Date().toISOString().slice(0, 10))
      ctx.addIssue({ code: "custom", path: ["observedOn"], message: "La data è nel futuro" });
  });

/** A metric typed by a person: exact number, source and date required, never an estimate. */
export async function addMetric(
  deps: AuditDeps,
  actor: Actor,
  input: z.input<typeof metricInputSchema>,
) {
  const data = metricInputSchema.parse(input);
  const { audit } = await editableAudit(deps, actor, data.auditId);
  const value = parseStrictNumber(data.value);
  if (value === null || value < 0)
    throw new ForgecyError(
      "validation",
      "Scrivi un numero esatto, senza intervalli o stime (es. 1.240).",
    );
  const userId = userIdOf(actor);
  const [row] = await deps.db
    .insert(auditMetrics)
    .values({
      auditId: data.auditId,
      channel: data.channel,
      metric: data.metric,
      value,
      observedOn: data.observedOn,
      source: data.source,
      sourceNote: data.sourceNote ?? null,
      createdBy: userId,
    })
    .returning();
  await markCollected(deps.db, data.auditId, data.channel, userId);
  await recordAuditEvent(deps.db, {
    actor,
    action: "audit.metric.add",
    entity: "audit",
    entityId: data.auditId,
    clientId: audit.clientId,
    meta: { channel: data.channel, metric: data.metric, source: data.source },
  });
  return row!;
}

export async function deleteMetric(deps: AuditDeps, actor: Actor, metricId: string) {
  const [metric] = await deps.db.select().from(auditMetrics).where(eq(auditMetrics.id, metricId));
  if (!metric) throw new ForgecyError("not_found", "Valore non trovato");
  await editableAudit(deps, actor, metric.auditId);
  if (metric.sourceId)
    throw new ForgecyError("validation", "Questo valore viene da un file: rimuovi il file.");
  await deps.db.delete(auditMetrics).where(eq(auditMetrics.id, metricId));
}

/**
 * Remove a screenshot or a file. Findings that cited it lose that evidence and go
 * back to "Da rivedere", so nothing in the report rests on a removed source.
 */
export async function removeSource(
  deps: AuditDeps,
  actor: Actor,
  sourceId: string,
): Promise<{ findingsReopened: number }> {
  const [source] = await deps.db.select().from(auditSources).where(eq(auditSources.id, sourceId));
  if (!source) throw new ForgecyError("not_found", "Fonte non trovata");
  const { audit } = await editableAudit(deps, actor, source.auditId);
  if (source.kind === "page")
    throw new ForgecyError("validation", "Le pagine del sito si aggiornano rileggendo il sito.");
  const citing = await deps.db
    .select()
    .from(auditFindings)
    .where(
      and(
        eq(auditFindings.auditId, source.auditId),
        sql`${auditFindings.evidence} @> ${JSON.stringify([{ sourceId }])}::jsonb`,
      ),
    );
  await deps.db.transaction(async (tx) => {
    for (const f of citing) {
      const evidence = (f.evidence as AuditEvidence[]).filter((e) => e.sourceId !== sourceId);
      await tx
        .update(auditFindings)
        .set({
          evidence,
          status: USABLE_FINDING_STATUSES.includes(f.status) ? "observed" : f.status,
          confidence: evidence.length >= 3 ? "high" : evidence.length === 2 ? "medium" : "low",
          confidenceReason: "Una fonte è stata rimossa: ricontrolla le prove",
          rev: sql`${auditFindings.rev} + 1`,
        })
        .where(eq(auditFindings.id, f.id));
    }
    await tx.delete(auditSources).where(eq(auditSources.id, sourceId));
    await recordAuditEvent(tx, {
      actor,
      action: "audit.source.remove",
      entity: "audit",
      entityId: source.auditId,
      clientId: audit.clientId,
      meta: { kind: source.kind, channel: source.channel, findings: citing.length },
    });
  });
  if (source.storageKey && deps.storage) {
    const [other] = await deps.db
      .select({ id: auditSources.id })
      .from(auditSources)
      .where(and(eq(auditSources.storageKey, source.storageKey), ne(auditSources.id, sourceId)))
      .limit(1);
    if (!other) await deps.storage.delete(source.storageKey).catch(() => undefined);
  }
  if (source.channel !== "website") {
    const channel = source.channel as SocialChannel;
    if (!(await channelHasData(deps.db, source.auditId, channel)))
      await upsertChannel(deps.db, {
        auditId: source.auditId,
        channel,
        status: "pending",
        updatedBy: userIdOf(actor),
      });
  }
  return { findingsReopened: citing.length };
}

/** Brand Analyst on a social channel: needs imported posts or typed metrics (not screenshots). */
export async function requestSocialAnalysis(
  deps: AuditDeps,
  actor: Actor,
  input: { auditId: string; channel: SocialChannel },
) {
  const { audit, client } = await editableAudit(deps, actor, input.auditId);
  assertAiAllowed(client);
  if (await hasActiveJob(deps.db, audit.id, auditAnalyzeSocialJob.kind))
    throw new ForgecyError("conflict", "Un'analisi dei social è già in corso.");
  const [posts] = await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditSocialPosts)
    .where(
      and(eq(auditSocialPosts.auditId, audit.id), eq(auditSocialPosts.channel, input.channel)),
    );
  const [metrics] = await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditMetrics)
    .where(and(eq(auditMetrics.auditId, audit.id), eq(auditMetrics.channel, input.channel)));
  const [shots] = await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditSources)
    .where(
      and(
        eq(auditSources.auditId, audit.id),
        eq(auditSources.channel, input.channel),
        eq(auditSources.kind, "screenshot"),
      ),
    );
  if (!(posts?.n ?? 0) && !(metrics?.n ?? 0) && !(shots?.n ?? 0))
    throw new ForgecyError(
      "validation",
      "Carica qualche screenshot, importa un export o inserisci almeno un valore.",
    );
  return enqueueAuditJob(deps, {
    def: auditAnalyzeSocialJob,
    payload: { auditId: audit.id, channel: input.channel },
    audit,
    createdBy: userIdOf(actor),
  });
}
