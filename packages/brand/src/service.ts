/**
 * Brand Identity workflow on the database: drafts, proposals, review and
 * publication. Every function checks permissions with `assertCan` and writes the
 * activity log in the same transaction. Agents can only create proposals: the
 * functions that touch a version refuse them before anything else.
 */
import {
  assertCan,
  ForgecyError,
  PermissionDeniedError,
  type Actor,
  type BrandSourceKind,
  type Permission,
} from "@forgecy/core";
import {
  and,
  brandIdentities,
  brandIdentityProposals,
  brandIdentityVersions,
  brandSources,
  clients,
  desc,
  eq,
  inArray,
  isNull,
  recordAuditEvent,
  sql,
  type Database,
} from "@forgecy/db";
import { publishChecks } from "./checks";
import {
  brandIdentityDocumentSchema,
  documentSections,
  emptyDocument,
  parseDocument,
  type BrandIdentityDocument,
  type DocumentSectionKey,
} from "./document";
import { fieldLabel, isSensitivePath, matchField, categoryOf } from "./fields";
import { deepEqual, isJsonPatch, JsonPatchError, type JsonPatch } from "./json-patch";
import {
  applyProposalPatch,
  buildProposalPatch,
  checksFor,
  computeConfidence,
  currentValue,
  findConflicts,
  proposedValue,
  stillApplies,
  withEditedValue,
  type DraftState,
  type EvidenceItem,
  type ProposalOp,
} from "./proposals";
import { defaultTokens, removedTokenPaths, validateTokens, type TokenTree } from "./tokens";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Tx;

export type VersionRow = typeof brandIdentityVersions.$inferSelect;
export type ProposalRow = typeof brandIdentityProposals.$inferSelect;
export type SourceRow = typeof brandSources.$inferSelect;

const OPEN = ["draft", "in_review"] as const;

function humanOnly(actor: Actor, permission: Permission): asserts actor is Extract<Actor, { type: "user" }> {
  // Invariant (spec "Governance"): an agent never edits, reviews, approves, publishes or archives.
  if (actor.type !== "user") throw new PermissionDeniedError(permission, actor);
}

const userId = (actor: Actor) => (actor.type === "user" ? actor.id : null);

function conflict(message: string, details?: Record<string, unknown>): never {
  throw new ForgecyError("conflict", message, details);
}
function notFound(message: string): never {
  throw new ForgecyError("not_found", message);
}
function invalid(message: string, details?: Record<string, unknown>): never {
  throw new ForgecyError("validation", message, details);
}

async function requireClient(db: Executor, clientId: string) {
  const [client] = await db
    .select({ id: clients.id, name: clients.name, aiPolicy: clients.aiPolicy, archivedAt: clients.archivedAt })
    .from(clients)
    .where(eq(clients.id, clientId));
  if (!client) notFound("Cliente non trovato");
  return client;
}

async function ensureIdentity(db: Executor, clientId: string) {
  await db.insert(brandIdentities).values({ clientId }).onConflictDoNothing();
  const [row] = await db.select().from(brandIdentities).where(eq(brandIdentities.clientId, clientId));
  return row!;
}

async function lockOpenDraft(tx: Tx, clientId: string): Promise<VersionRow | undefined> {
  const [row] = await tx
    .select()
    .from(brandIdentityVersions)
    .where(and(eq(brandIdentityVersions.clientId, clientId), inArray(brandIdentityVersions.status, [...OPEN])))
    .for("update");
  return row;
}

async function publishedRow(db: Executor, clientId: string): Promise<VersionRow | undefined> {
  const [row] = await db
    .select()
    .from(brandIdentityVersions)
    .where(and(eq(brandIdentityVersions.clientId, clientId), eq(brandIdentityVersions.status, "published")));
  return row;
}

async function nextNumber(db: Executor, identityId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`coalesce(max(${brandIdentityVersions.number}), 0)::int` })
    .from(brandIdentityVersions)
    .where(eq(brandIdentityVersions.brandIdentityId, identityId));
  return (r?.n ?? 0) + 1;
}

const stateOf = (v: Pick<VersionRow, "document" | "tokens">): DraftState => ({
  document: parseDocument(v.document),
  tokens: v.tokens as TokenTree,
});

/** Open draft of the client, created on demand from the published version (or empty). */
async function openDraft(tx: Tx, clientId: string, createdBy: string | null): Promise<VersionRow> {
  const existing = await lockOpenDraft(tx, clientId);
  if (existing) return existing;
  const identity = await ensureIdentity(tx, clientId);
  const published = await publishedRow(tx, clientId);
  const [row] = await tx
    .insert(brandIdentityVersions)
    .values({
      brandIdentityId: identity.id,
      clientId,
      number: await nextNumber(tx, identity.id),
      status: "draft",
      document: (published?.document ?? emptyDocument()) as Record<string, unknown>,
      tokens: (published?.tokens ?? defaultTokens()) as Record<string, unknown>,
      createdBy,
    })
    .returning();
  await recordAuditEvent(tx, {
    actor: "system",
    action: "brand.draft.create",
    entity: "brand_identity_version",
    entityId: row!.id,
    clientId,
    meta: { number: row!.number, from: published ? published.number : null },
  });
  return row!;
}

/** Marks pending proposals whose patch no longer applies to `state` as stale. */
async function refreshStale(
  tx: Tx,
  identityId: string,
  state: DraftState,
  reason = "Il campo è cambiato dopo la proposta",
  alsoFieldPath?: { fieldPath: string; exceptId: string },
): Promise<number> {
  const pending = await tx
    .select({ id: brandIdentityProposals.id, changes: brandIdentityProposals.changes, fieldPath: brandIdentityProposals.fieldPath })
    .from(brandIdentityProposals)
    .where(and(eq(brandIdentityProposals.brandIdentityId, identityId), eq(brandIdentityProposals.status, "proposed")));
  const stale = pending
    .filter(
      (p) =>
        (alsoFieldPath && p.id !== alsoFieldPath.exceptId && p.fieldPath === alsoFieldPath.fieldPath && !p.fieldPath.endsWith("/-")) ||
        !stillApplies(state, p.changes as JsonPatch),
    )
    .map((p) => p.id);
  if (stale.length)
    await tx
      .update(brandIdentityProposals)
      .set({ status: "stale", staleReason: reason })
      .where(inArray(brandIdentityProposals.id, stale));
  return stale.length;
}

async function writeDraft(
  tx: Tx,
  draft: VersionRow,
  state: DraftState,
  editor: string | null,
): Promise<VersionRow> {
  const editors = editor && !draft.editorIds.includes(editor) ? [...draft.editorIds, editor] : draft.editorIds;
  const [row] = await tx
    .update(brandIdentityVersions)
    .set({
      document: state.document as unknown as Record<string, unknown>,
      tokens: state.tokens as Record<string, unknown>,
      rev: draft.rev + 1,
      lastEditedBy: editor,
      editorIds: editors,
    })
    .where(and(eq(brandIdentityVersions.id, draft.id), eq(brandIdentityVersions.rev, draft.rev)))
    .returning();
  if (!row) conflict("La bozza è stata modificata da qualcun altro. Ricarica la pagina.", { code: "CONFLICT-DRAFT-REV" });
  return row;
}

// ---------- Drafts ----------

/** Opens (or returns) the client's draft. Users only: agents propose on whatever draft exists. */
export async function ensureDraft(db: Database, actor: Actor, clientId: string): Promise<VersionRow> {
  humanOnly(actor, "edit_draft");
  assertCan(actor, "edit_draft", clientId);
  await requireClient(db, clientId);
  return db.transaction((tx) => openDraft(tx, clientId, actor.id));
}

/**
 * Keeps sources and confidence of items whose value did not change and resets
 * them for values a person rewrote: direct input, no cited source.
 */
export function normalizeHumanEdit(before: unknown, after: unknown): unknown {
  const old = new Map<string, Record<string, unknown>>();
  const isSourced = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && "id" in v && "value" in v && "sourceIds" in v;
  const collect = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(collect);
    else if (typeof v === "object" && v !== null) {
      if (isSourced(v)) old.set(String(v.id), v);
      Object.values(v).forEach(collect);
    }
  };
  collect(before);
  const fix = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(fix);
    if (typeof v !== "object" || v === null) return v;
    if (isSourced(v)) {
      const prev = old.get(String(v.id));
      if (prev && deepEqual(prev.value, v.value))
        return {
          ...v,
          sourceIds: prev.sourceIds,
          confidence: prev.confidence,
          ...(prev.acceptedFromProposalId ? { acceptedFromProposalId: prev.acceptedFromProposalId } : {}),
          ...(prev.deprecated || v.deprecated ? { deprecated: Boolean(v.deprecated) } : {}),
        };
      const { acceptedFromProposalId: _a, ...rest } = v;
      return { ...rest, sourceIds: [], confidence: "high" };
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)]));
  };
  return fix(after);
}

export interface SaveSectionInput {
  clientId: string;
  versionId: string;
  rev: number;
  section: DocumentSectionKey;
  value: unknown;
}

/** A person saves one block of the draft. Pending proposals on changed fields go stale. */
export async function saveDraftSection(
  db: Database,
  actor: Actor,
  input: SaveSectionInput,
): Promise<{ rev: number; staled: number }> {
  humanOnly(actor, "edit_draft");
  assertCan(actor, "edit_draft", input.clientId);
  const schema = documentSections[input.section];
  if (!schema) invalid("Sezione sconosciuta");
  return db.transaction(async (tx) => {
    const draft = await lockOpenDraft(tx, input.clientId);
    if (!draft || draft.id !== input.versionId) conflict("Questa bozza non è più aperta.", { code: "DRAFT-CLOSED" });
    if (draft.rev !== input.rev)
      conflict("La bozza è stata modificata da qualcun altro. Ricarica la pagina.", { code: "CONFLICT-DRAFT-REV" });
    const state = stateOf(draft);
    const normalized = normalizeHumanEdit(state.document[input.section], input.value);
    const parsed = schema.safeParse(normalized);
    if (!parsed.success)
      invalid(parsed.error.issues[0]?.message ?? "Dati non validi", {
        issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    const next: DraftState = {
      document: { ...state.document, [input.section]: parsed.data } as BrandIdentityDocument,
      tokens: state.tokens,
    };
    const row = await writeDraft(tx, draft, next, actor.id);
    const staled = await refreshStale(tx, draft.brandIdentityId, next);
    await recordAuditEvent(tx, {
      actor,
      action: "brand.draft.edit",
      entity: "brand_identity_version",
      entityId: draft.id,
      clientId: input.clientId,
      meta: { section: input.section, rev: row.rev, staled },
    });
    return { rev: row.rev, staled };
  });
}

/** A person saves the token tree (palette, semantic mapping, fonts, components). */
export async function saveDraftTokens(
  db: Database,
  actor: Actor,
  input: { clientId: string; versionId: string; rev: number; tokens: TokenTree },
): Promise<{ rev: number; staled: number }> {
  humanOnly(actor, "edit_draft");
  assertCan(actor, "edit_draft", input.clientId);
  const issues = validateTokens(input.tokens);
  if (issues.length) invalid(`Token non validi: ${issues[0]!.path} ${issues[0]!.message}`, { issues });
  return db.transaction(async (tx) => {
    const draft = await lockOpenDraft(tx, input.clientId);
    if (!draft || draft.id !== input.versionId) conflict("Questa bozza non è più aperta.", { code: "DRAFT-CLOSED" });
    if (draft.rev !== input.rev)
      conflict("La bozza è stata modificata da qualcun altro. Ricarica la pagina.", { code: "CONFLICT-DRAFT-REV" });
    const state = stateOf(draft);
    const next = { document: state.document, tokens: input.tokens };
    const row = await writeDraft(tx, draft, next, actor.id);
    const staled = await refreshStale(tx, draft.brandIdentityId, next);
    await recordAuditEvent(tx, {
      actor,
      action: "brand.draft.edit",
      entity: "brand_identity_version",
      entityId: draft.id,
      clientId: input.clientId,
      meta: { section: "tokens", rev: row.rev, staled },
    });
    return { rev: row.rev, staled };
  });
}

// ---------- Proposals ----------

export interface ProposeInput {
  clientId: string;
  /** JSON Pointer under { document, tokens }, e.g. /document/strategy/oneLiner. */
  path: string;
  op?: ProposalOp;
  value?: unknown;
  title?: string;
  rationale?: string;
  evidence?: EvidenceItem[];
  /** What the model said about its confidence (0–1). Stored, never used to decide. */
  modelConfidence?: number;
  /** Non-sensitive details for the activity log (model, prompt version). */
  auditMeta?: Record<string, string | number | null>;
}

/**
 * Creates a proposal on the client's draft (agents and people alike). The patch
 * is computed now, against the current draft, with `test` ops on every value it
 * replaces. Confidence comes from the cited sources.
 */
export async function proposeChange(db: Database, actor: Actor, input: ProposeInput): Promise<ProposalRow> {
  assertCan(actor, "brand_identity.propose", input.clientId);
  await requireClient(db, input.clientId);
  const evidence = (input.evidence ?? []).slice(0, 20);
  return db.transaction(async (tx) => {
    const draft = await openDraft(tx, input.clientId, null);
    const state = stateOf(draft);
    const sourceIds = [...new Set(evidence.map((e) => e.sourceId))];
    const kinds = await sourceKinds(tx, input.clientId, sourceIds);
    if (kinds.size !== sourceIds.length) invalid("Una delle fonti citate non esiste per questo cliente");
    const evidenceKinds = sourceIds.map((id) => kinds.get(id)!);
    if (actor.type === "agent" && !evidenceKinds.length) evidenceKinds.push("agent_observation");

    const id = globalThis.crypto.randomUUID();
    const confidence = computeConfidence(evidenceKinds);
    const built = buildProposalPatch(state, { path: input.path, op: input.op ?? "set", value: input.value }, {
      proposalId: id,
      sourceIds,
      confidence,
    });
    if (!stillApplies(state, built.patch)) conflict("La proposta non si applica alla bozza attuale");
    const value = proposedValue(built.patch, built.field);
    if (built.written !== undefined && deepEqual(value, currentValue(state, built.patch, built.field)))
      invalid("Il valore proposto è già nella bozza", { code: "NO-CHANGE" });
    const [row] = await tx
      .insert(brandIdentityProposals)
      .values({
        id,
        clientId: input.clientId,
        brandIdentityId: draft.brandIdentityId,
        authorType: actor.type,
        authorUserId: userId(actor),
        agentRole: actor.type === "agent" ? actor.role : null,
        runId: actor.type === "agent" ? (actor.runId ?? null) : null,
        baseVersionId: draft.id,
        baseRev: draft.rev,
        fieldPath: built.fieldPath,
        category: categoryOf(input.path),
        title: (input.title ?? fieldLabel(input.path)).slice(0, 200),
        changes: built.patch as unknown as Array<Record<string, unknown>>,
        rationale: input.rationale?.slice(0, 4000) ?? null,
        evidence,
        confidence,
        modelConfidence:
          typeof input.modelConfidence === "number" ? Math.max(0, Math.min(1, input.modelConfidence)) : null,
        checks: checksFor(state, built.field, value),
        sensitive: isSensitivePath(input.path),
      })
      .returning();
    await recordAuditEvent(tx, {
      actor,
      action: "brand.proposal.create",
      entity: "brand_identity_proposal",
      entityId: id,
      clientId: input.clientId,
      meta: { ...input.auditMeta, field: built.fieldPath, sensitive: row!.sensitive, confidence },
    });
    return row!;
  });
}

async function sourceKinds(db: Executor, clientId: string, ids: string[]): Promise<Map<string, BrandSourceKind>> {
  if (!ids.length) return new Map();
  const valid = ids.filter((i) => /^[0-9a-f-]{36}$/i.test(i));
  if (!valid.length) return new Map();
  const rows = await db
    .select({ id: brandSources.id, kind: brandSources.kind })
    .from(brandSources)
    .where(and(eq(brandSources.clientId, clientId), inArray(brandSources.id, valid), isNull(brandSources.removedAt)));
  return new Map(rows.map((r) => [r.id, r.kind]));
}

/** Effective confidence: stored level, downgraded to low while the proposal is in conflict. */
export async function conflictsFor(db: Executor, clientId: string) {
  const pending = await db
    .select()
    .from(brandIdentityProposals)
    .where(and(eq(brandIdentityProposals.clientId, clientId), eq(brandIdentityProposals.status, "proposed")));
  const allSources = [...new Set(pending.flatMap((p) => p.evidence.map((e) => e.sourceId)))];
  const kinds = await sourceKinds(db, clientId, allSources);
  return findConflicts(
    pending.map((p) => ({
      id: p.id,
      fieldPath: p.fieldPath,
      changes: p.changes as JsonPatch,
      evidenceKinds: p.evidence.map((e) => kinds.get(e.sourceId)).filter((k): k is BrandSourceKind => !!k),
    })),
  );
}

export interface AcceptInput {
  clientId: string;
  proposalId: string;
  note?: string;
  /** "Accetta con modifiche": the corrected raw value. */
  editedValue?: unknown;
}

export interface AcceptResult {
  status: "accepted" | "stale";
  /** Other pending proposals that became stale. */
  staled: number;
  rev?: number;
}

async function acceptOne(tx: Tx, actor: Extract<Actor, { type: "user" }>, input: AcceptInput, bulk: boolean): Promise<AcceptResult> {
  const [p] = await tx
    .select()
    .from(brandIdentityProposals)
    .where(and(eq(brandIdentityProposals.id, input.proposalId), eq(brandIdentityProposals.clientId, input.clientId)))
    .for("update");
  if (!p) notFound("Proposta non trovata");
  if (p.status !== "proposed") conflict("La proposta è già stata decisa.");
  if (bulk && p.sensitive) invalid("Le proposte sensibili si accettano una per una.");

  const conflicting = (await conflictsFor(tx, input.clientId)).some((c) => c.proposalIds.includes(p.id));
  const effectiveLow = p.confidence === "low" || conflicting;
  const note = input.note?.trim() ?? "";
  if (p.sensitive && effectiveLow && note.length < 10)
    invalid("Perché accetti nonostante la confidenza bassa? Scrivi una nota di almeno 10 caratteri.", {
      code: "NOTE-REQUIRED",
    });

  const draft = await openDraft(tx, input.clientId, actor.id);
  const match = matchField(p.fieldPath.replace(/\[.*\]$/, "").replace(/\/-$/, ""));
  if (!match) invalid("Campo della proposta sconosciuto");
  let patch = p.changes as JsonPatch;
  if (!isJsonPatch(patch)) invalid("Proposta malformata");
  if (input.editedValue !== undefined) patch = withEditedValue(patch, input.editedValue, match.field);

  const state = stateOf(draft);
  let next: DraftState;
  try {
    next = applyProposalPatch(state, patch);
  } catch (err) {
    if (!(err instanceof JsonPatchError)) throw err;
    await tx
      .update(brandIdentityProposals)
      .set({ status: "stale", staleReason: "Il campo è cambiato dopo la proposta" })
      .where(eq(brandIdentityProposals.id, p.id));
    return { status: "stale", staled: 0 };
  }
  const parsed = brandIdentityDocumentSchema.safeParse(next.document);
  if (!parsed.success) invalid(`Il valore proposto non è valido: ${parsed.error.issues[0]?.message ?? ""}`);
  if (p.fieldPath.startsWith("/tokens/")) {
    const issues = validateTokens(next.tokens);
    if (issues.length) invalid(`Il token proposto non si risolve: ${issues[0]!.path} ${issues[0]!.message}`);
  }
  next = { document: parsed.data, tokens: next.tokens };
  const row = await writeDraft(tx, draft, next, actor.id);
  await tx
    .update(brandIdentityProposals)
    .set({
      status: "accepted",
      reviewedBy: actor.id,
      reviewedAt: new Date(),
      reviewNote: note || null,
      editedValue: input.editedValue === undefined ? null : (input.editedValue as never),
      baseVersionId: draft.id,
    })
    .where(eq(brandIdentityProposals.id, p.id));
  const staled = await refreshStale(tx, draft.brandIdentityId, next, "Il campo è cambiato dopo la proposta", {
    fieldPath: p.fieldPath,
    exceptId: p.id,
  });
  await recordAuditEvent(tx, {
    actor,
    action: input.editedValue === undefined ? "brand.proposal.accept" : "brand.proposal.accept_edited",
    entity: "brand_identity_proposal",
    entityId: p.id,
    clientId: input.clientId,
    meta: { field: p.fieldPath, version: draft.number, sensitive: p.sensitive, staled, note: note || undefined },
  });
  return { status: "accepted", staled, rev: row.rev };
}

/** Accepts one proposal into the draft (or marks it stale when the field changed). */
export async function acceptProposal(db: Database, actor: Actor, input: AcceptInput): Promise<AcceptResult> {
  humanOnly(actor, "review");
  assertCan(actor, "review", input.clientId);
  assertCan(actor, "edit_draft", input.clientId);
  return db.transaction((tx) => acceptOne(tx, actor, input, false));
}

/** "Accetta selezionate": non-sensitive proposals only, at most 50 at a time. */
export async function acceptProposals(
  db: Database,
  actor: Actor,
  input: { clientId: string; proposalIds: string[] },
): Promise<{ accepted: number; stale: number }> {
  humanOnly(actor, "review");
  assertCan(actor, "review", input.clientId);
  assertCan(actor, "edit_draft", input.clientId);
  if (input.proposalIds.length > 50) invalid("Al massimo 50 proposte per volta");
  return db.transaction(async (tx) => {
    let accepted = 0;
    let stale = 0;
    for (const proposalId of input.proposalIds) {
      const [p] = await tx
        .select({ status: brandIdentityProposals.status })
        .from(brandIdentityProposals)
        .where(eq(brandIdentityProposals.id, proposalId));
      if (p?.status !== "proposed") continue; // made stale by an earlier one in this batch
      const r = await acceptOne(tx, actor, { clientId: input.clientId, proposalId }, true);
      if (r.status === "accepted") accepted++;
      else stale++;
    }
    return { accepted, stale };
  });
}

export async function rejectProposals(
  db: Database,
  actor: Actor,
  input: { clientId: string; proposalIds: string[]; note?: string },
): Promise<{ rejected: number }> {
  humanOnly(actor, "review");
  assertCan(actor, "review", input.clientId);
  if (input.proposalIds.length > 50) invalid("Al massimo 50 proposte per volta");
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(brandIdentityProposals)
      .set({ status: "rejected", reviewedBy: actor.id, reviewedAt: new Date(), reviewNote: input.note?.trim() || null })
      .where(
        and(
          eq(brandIdentityProposals.clientId, input.clientId),
          inArray(brandIdentityProposals.id, input.proposalIds),
          eq(brandIdentityProposals.status, "proposed"),
        ),
      )
      .returning({ id: brandIdentityProposals.id, fieldPath: brandIdentityProposals.fieldPath });
    for (const r of rows)
      await recordAuditEvent(tx, {
        actor,
        action: "brand.proposal.reject",
        entity: "brand_identity_proposal",
        entityId: r.id,
        clientId: input.clientId,
        meta: { field: r.fieldPath },
      });
    return { rejected: rows.length };
  });
}

// ---------- Review and publication ----------

export async function submitForReview(
  db: Database,
  actor: Actor,
  input: { clientId: string; versionId: string; rev: number },
): Promise<void> {
  humanOnly(actor, "edit_draft");
  assertCan(actor, "edit_draft", input.clientId);
  await db.transaction(async (tx) => {
    const draft = await lockOpenDraft(tx, input.clientId);
    if (!draft || draft.id !== input.versionId) conflict("Questa bozza non è più aperta.");
    if (draft.status !== "draft") conflict("La bozza è già in revisione.");
    if (draft.rev !== input.rev)
      conflict("La bozza è stata modificata da qualcun altro. Ricarica la pagina.", { code: "CONFLICT-DRAFT-REV" });
    const conflicts = await conflictsFor(tx, input.clientId);
    const sensitiveConflicts = conflicts.filter((c) => isSensitivePath(c.fieldPath.replace(/\[.*\]$/, "")));
    if (sensitiveConflicts.length)
      conflict(`Risolvi ${sensitiveConflicts.length} conflitti sui campi sensibili prima di inviare.`, {
        code: "CONFLICTS-OPEN",
      });
    await tx
      .update(brandIdentityVersions)
      .set({ status: "in_review", submittedBy: actor.id, submittedAt: new Date(), reviewComment: null })
      .where(eq(brandIdentityVersions.id, draft.id));
    await recordAuditEvent(tx, {
      actor,
      action: "brand.version.submit",
      entity: "brand_identity_version",
      entityId: draft.id,
      clientId: input.clientId,
      meta: { number: draft.number, rev: draft.rev },
    });
  });
}

/** "Rimanda con commento" (comment required) or "Ritira dalla revisione" (no comment). */
export async function returnToDraft(
  db: Database,
  actor: Actor,
  input: { clientId: string; versionId: string; comment?: string },
): Promise<void> {
  humanOnly(actor, "review");
  assertCan(actor, "review", input.clientId);
  await db.transaction(async (tx) => {
    const draft = await lockOpenDraft(tx, input.clientId);
    if (!draft || draft.id !== input.versionId || draft.status !== "in_review")
      conflict("Questa versione non è in revisione.");
    await tx
      .update(brandIdentityVersions)
      .set({ status: "draft", reviewComment: input.comment?.trim() || null })
      .where(eq(brandIdentityVersions.id, draft.id));
    await recordAuditEvent(tx, {
      actor,
      action: input.comment ? "brand.version.request_changes" : "brand.version.withdraw",
      entity: "brand_identity_version",
      entityId: draft.id,
      clientId: input.clientId,
      meta: { number: draft.number },
    });
  });
}

export const CHANGELOG_MIN = 20;
export const SELF_APPROVAL_NOTE_MIN = 10;

export interface PublishInput {
  clientId: string;
  versionId: string;
  /** The revision the approver looked at: publishing a newer one requires a fresh look. */
  rev: number;
  changelog: string;
  /** Required when the approver prepared or submitted the draft. */
  note?: string;
  /** Keys of the open checks confirmed with "Ho visto". */
  acknowledged: string[];
}

export interface PublishResult {
  versionId: string;
  number: number;
  archivedVersionId: string | null;
  removedTokens: string[];
}

/** True when the approver submitted or edited this draft (self-approval needs a note). */
export function isSelfApproval(version: Pick<VersionRow, "submittedBy" | "editorIds" | "createdBy">, uid: string) {
  return version.submittedBy === uid || version.editorIds.includes(uid) || version.createdBy === uid;
}

/**
 * "Approva e pubblica": one person approves and publishes in one step (MVP).
 * The previous published version is archived; the new one becomes immutable.
 */
export async function approveAndPublish(db: Database, actor: Actor, input: PublishInput): Promise<PublishResult> {
  humanOnly(actor, "brand_identity.approve");
  assertCan(actor, "brand_identity.approve", input.clientId);
  assertCan(actor, "publish", input.clientId);
  const changelog = input.changelog.trim();
  if (changelog.length < CHANGELOG_MIN)
    invalid(`Scrivi un changelog di almeno ${CHANGELOG_MIN} caratteri.`, { code: "CHANGELOG-REQUIRED" });

  return db.transaction(async (tx) => {
    const draft = await lockOpenDraft(tx, input.clientId);
    if (!draft || draft.id !== input.versionId) conflict("Questa bozza non è più aperta.");
    if (draft.rev !== input.rev)
      conflict("La bozza è cambiata dopo che l'hai rivista. Ricontrolla le modifiche.", { code: "CONFLICT-DRAFT-REV" });
    const note = input.note?.trim() ?? "";
    if (isSelfApproval(draft, actor.id) && note.length < SELF_APPROVAL_NOTE_MIN)
      invalid("Stai approvando una bozza che hai preparato tu. Scrivi una nota per la cronologia.", {
        code: "SELF-APPROVAL-NOTE",
      });

    const parsed = brandIdentityDocumentSchema.safeParse(draft.document);
    if (!parsed.success) invalid(`La bozza non è valida: ${parsed.error.issues[0]?.message ?? ""}`);
    const tokens = draft.tokens as TokenTree;
    const tokenIssues = validateTokens(tokens);
    if (tokenIssues.length) invalid(`Token non validi: ${tokenIssues[0]!.path}`, { code: "TOKENS-INVALID" });

    const previous = await publishedRow(tx, input.clientId);
    const pending = await tx
      .select({ sensitive: brandIdentityProposals.sensitive })
      .from(brandIdentityProposals)
      .where(and(eq(brandIdentityProposals.clientId, input.clientId), eq(brandIdentityProposals.status, "proposed")));
    const conflicts = await conflictsFor(tx, input.clientId);
    const checks = publishChecks(parsed.data, tokens, {
      publishedTokens: (previous?.tokens as TokenTree | undefined) ?? null,
      pendingSensitive: pending.filter((p) => p.sensitive).length,
      conflicts: conflicts.length,
    });
    const missing = checks.filter((c) => !input.acknowledged.includes(c.key));
    if (missing.length)
      invalid(`Conferma i controlli aperti: ${missing.map((m) => m.message).join("; ")}`, {
        code: "CHECKS-NOT-ACKNOWLEDGED",
        missing: missing.map((m) => m.key),
      });

    const now = new Date();
    if (previous)
      await tx
        .update(brandIdentityVersions)
        .set({ status: "archived", archivedAt: now })
        .where(eq(brandIdentityVersions.id, previous.id));
    await tx
      .update(brandIdentityVersions)
      .set({
        status: "published",
        document: parsed.data as unknown as Record<string, unknown>,
        changelog,
        approvedBy: actor.id,
        approvedAt: now,
        approvalNote: note || null,
        publishedBy: actor.id,
        publishedAt: now,
        acknowledgedChecks: checks.map((c) => c.key),
      })
      .where(eq(brandIdentityVersions.id, draft.id));
    const removedTokens = previous ? removedTokenPaths(previous.tokens as TokenTree, tokens) : [];
    for (const action of ["brand.version.approve", "brand.version.publish"])
      await recordAuditEvent(tx, {
        actor,
        action,
        entity: "brand_identity_version",
        entityId: draft.id,
        clientId: input.clientId,
        meta: {
          number: draft.number,
          previous: previous?.number ?? null,
          selfApproval: isSelfApproval(draft, actor.id),
          acknowledged: checks.map((c) => c.key),
          removedTokens,
        },
      });
    return { versionId: draft.id, number: draft.number, archivedVersionId: previous?.id ?? null, removedTokens };
  });
}

/**
 * "Ripristina come bozza": a new draft with the content of an older version. The
 * history is never rewritten; the restored draft goes through review like any other.
 * With `replaceDraft` an open draft is archived and its accepted proposals become stale.
 */
export async function restoreAsDraft(
  db: Database,
  actor: Actor,
  input: { clientId: string; versionId: string; replaceDraft?: boolean },
): Promise<VersionRow> {
  humanOnly(actor, "edit_draft");
  assertCan(actor, "edit_draft", input.clientId);
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(brandIdentityVersions)
      .where(and(eq(brandIdentityVersions.id, input.versionId), eq(brandIdentityVersions.clientId, input.clientId)));
    if (!source) notFound("Versione non trovata");
    if (source.status !== "published" && source.status !== "archived")
      invalid("Si ripristinano solo versioni pubblicate o archiviate.");
    const open = await lockOpenDraft(tx, input.clientId);
    if (open) {
      if (!input.replaceDraft)
        conflict(`Esiste già la bozza v${open.number}. Conferma per sostituirla.`, {
          code: "DRAFT-EXISTS",
          draftNumber: open.number,
        });
      await tx
        .update(brandIdentityVersions)
        .set({ status: "archived", archivedAt: new Date() })
        .where(eq(brandIdentityVersions.id, open.id));
      await tx
        .update(brandIdentityProposals)
        .set({ status: "stale", staleReason: `La bozza v${open.number} è stata sostituita da un ripristino` })
        .where(and(eq(brandIdentityProposals.baseVersionId, open.id), eq(brandIdentityProposals.status, "accepted")));
    }
    const [row] = await tx
      .insert(brandIdentityVersions)
      .values({
        brandIdentityId: source.brandIdentityId,
        clientId: input.clientId,
        number: await nextNumber(tx, source.brandIdentityId),
        status: "draft",
        document: source.document,
        tokens: source.tokens,
        restoredFromVersionId: source.id,
        createdBy: actor.id,
        editorIds: [actor.id],
      })
      .returning();
    await refreshStale(tx, source.brandIdentityId, stateOf(row!));
    await recordAuditEvent(tx, {
      actor,
      action: "brand.version.restore",
      entity: "brand_identity_version",
      entityId: row!.id,
      clientId: input.clientId,
      meta: { number: row!.number, restoredFrom: source.number, replacedDraft: open?.number ?? null },
    });
    return row!;
  });
}

// ---------- Sources ----------

export interface AddSourceInput {
  clientId: string;
  kind: BrandSourceKind;
  title: string;
  url?: string | null;
  storageKey?: string | null;
  mime?: string | null;
  size?: number | null;
  sha256?: string | null;
  externalRef?: string | null;
  note?: string | null;
  /** Pages already extracted (manual notes, audit observations). */
  pages?: Array<{ locator: string; text: string }>;
  status?: SourceRow["status"];
}

/** Registers a source. Agents may add their own observations as sources. */
export async function addSource(db: Database, actor: Actor, input: AddSourceInput): Promise<SourceRow> {
  assertCan(actor, actor.type === "agent" ? "brand_identity.propose" : "edit_draft", input.clientId);
  await requireClient(db, input.clientId);
  if (input.url && !/^https?:\/\//i.test(input.url)) invalid("Indirizzo non valido: solo http e https");
  return db.transaction(async (tx) => {
    if (input.sha256) {
      const [dup] = await tx
        .select({ id: brandSources.id, title: brandSources.title })
        .from(brandSources)
        .where(and(eq(brandSources.clientId, input.clientId), eq(brandSources.sha256, input.sha256), isNull(brandSources.removedAt)));
      if (dup) conflict(`Il file è già tra le fonti: ${dup.title}`, { code: "SOURCE-DUPLICATE", sourceId: dup.id });
    }
    const [row] = await tx
      .insert(brandSources)
      .values({
        clientId: input.clientId,
        kind: input.kind,
        title: input.title.slice(0, 300),
        url: input.url ?? null,
        storageKey: input.storageKey ?? null,
        mime: input.mime ?? null,
        size: input.size ?? null,
        sha256: input.sha256 ?? null,
        externalRef: input.externalRef ?? null,
        note: input.note ?? null,
        pages: input.pages ?? null,
        status: input.status ?? (input.storageKey ? "pending" : "extracted"),
        createdBy: userId(actor),
      })
      .returning();
    await recordAuditEvent(tx, {
      actor,
      action: "brand.source.add",
      entity: "brand_source",
      entityId: row!.id,
      clientId: input.clientId,
      meta: { kind: input.kind },
    });
    return row!;
  });
}

/** Removes a source from use; pending proposals citing it become stale. The file and history stay. */
export async function removeSource(
  db: Database,
  actor: Actor,
  input: { clientId: string; sourceId: string },
): Promise<{ staled: number }> {
  humanOnly(actor, "edit_draft");
  assertCan(actor, "edit_draft", input.clientId);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(brandSources)
      .set({ removedAt: new Date() })
      .where(and(eq(brandSources.id, input.sourceId), eq(brandSources.clientId, input.clientId), isNull(brandSources.removedAt)))
      .returning({ id: brandSources.id });
    if (!row) notFound("Fonte non trovata");
    const stale = await tx
      .update(brandIdentityProposals)
      .set({ status: "stale", staleReason: "La fonte della proposta è stata rimossa" })
      .where(
        and(
          eq(brandIdentityProposals.clientId, input.clientId),
          eq(brandIdentityProposals.status, "proposed"),
          sql`${brandIdentityProposals.evidence} @> ${JSON.stringify([{ sourceId: input.sourceId }])}::jsonb`,
        ),
      )
      .returning({ id: brandIdentityProposals.id });
    await recordAuditEvent(tx, {
      actor,
      action: "brand.source.remove",
      entity: "brand_source",
      entityId: input.sourceId,
      clientId: input.clientId,
      meta: { staled: stale.length },
    });
    return { staled: stale.length };
  });
}

/** Internal: state of an extraction, written by the import job. */
export async function updateSourceStatus(
  db: Executor,
  sourceId: string,
  values: Partial<Pick<SourceRow, "status" | "statusDetail" | "pages">>,
): Promise<void> {
  await db.update(brandSources).set(values).where(eq(brandSources.id, sourceId));
}

export async function listVersionsRaw(db: Executor, clientId: string): Promise<VersionRow[]> {
  return db
    .select()
    .from(brandIdentityVersions)
    .where(eq(brandIdentityVersions.clientId, clientId))
    .orderBy(desc(brandIdentityVersions.number));
}
