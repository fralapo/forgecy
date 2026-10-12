/**
 * Automatic import (spec 2026-10-09, "Auto-accept and publish"): the verified proposals of one
 * import run go into the draft and the draft is published, on behalf of the person who started
 * the run. That person is the approver of record and must hold every permission the review and
 * publish buttons need, on this client; nothing here takes an actor from the caller, so an agent
 * cannot run it as itself. Fields a person wrote are never overwritten.
 */
import {
  assertCan,
  can,
  canAccessClient,
  ForgecyError,
  PermissionDeniedError,
  type Actor,
  type BrandSourceKind,
  type MessageRef,
  type Permission,
} from "@forgecy/core";
import {
  and,
  auditEvents,
  brandIdentityProposals,
  brandIdentityVersions,
  brandSources,
  desc,
  eq,
  inArray,
  isNull,
  recordAuditEvent,
  sql,
  userActor,
  type Database,
} from "@forgecy/db";
import { englishMessage, localizedError, messageRef } from "@forgecy/i18n";
import { emptyDocument, parseDocument } from "./document";
import { matchField, type FieldDef } from "./fields";
import { deepEqual, getAt, isJsonPatch, type JsonPatch } from "./json-patch";
import type { DraftState } from "./proposals";
import {
  acceptOne,
  conflictsFor,
  lockOpenDraft,
  publishDraft,
  restoreDraft,
  type BrandTx,
  type PublishInput,
  type PublishResult,
} from "./service";
import { defaultTokens, type TokenTree } from "./tokens";

/** Source kinds whose imports apply themselves: read from public pages and verified by the gate. */
export const AUTO_IMPORT_KINDS: ReadonlySet<BrandSourceKind> = new Set<BrandSourceKind>([
  "website",
  "instagram",
  "facebook",
  "linkedin",
  "tiktok",
]);

/** What the person needs on the client to accept proposals and publish: the same as the buttons. */
const NEEDED: readonly Permission[] = ["review", "edit_draft", "publish", "brand_identity.approve"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HAND_EDITED_NOTE = "hand-edited field kept";
const SEMANTIC = "/tokens/color/semantic/";
const CHANGELOG_MAX = 300;
const TITLE_MAX = 60;

export type AutoNotAppliedReason = "no_requester" | "no_access" | "no_permission";
export type AutoNotPublishedReason = "draft_shared" | "not_publishable";

export interface AutoImportInput {
  clientId: string;
  /** The person who started the run; null for runs nobody started (they never apply). */
  requestedBy: string | null;
  runId: string;
}

export interface AutoImportResult {
  accepted: number;
  /** Proposals not applied because a person wrote that field (marked rejected). */
  skippedHandEdited: number;
  /** Left pending for a person: contested by another source, or sensitive and uncertain. */
  needsReview: number;
  /** Proposals that no longer apply (stale) or are invalid; invalid ones stay pending for a person. */
  discarded: number;
  published: boolean;
  versionId?: string;
  /**
   * Why nothing was applied (proposals stay pending), or why the accepted items were not
   * published: the draft holds someone else's work, or does not pass the publish checks.
   */
  reason?: AutoNotAppliedReason | AutoNotPublishedReason;
}

/** What decides whether a value in the draft is a person's work, read once per run. */
export interface Provenance {
  /** The client's live sources an import reads by itself (website, social profiles). */
  autoSourceIds: ReadonlySet<string>;
  /** Proposals a person accepted from the review queue (not an import run on their behalf). */
  personAccepted: ReadonlySet<string>;
}

/**
 * A value an import must leave alone: a person typed it (no cited source), it is confirmed
 * (high), it rests on a source an import does not read by itself (a brand book, an interview,
 * a removed source), or a person accepted it from the review queue.
 */
export function isHandEdited(
  item: { sourceIds: string[]; confidence: string; acceptedFromProposalId?: string },
  provenance: Provenance,
): boolean {
  return (
    item.sourceIds.length === 0 ||
    item.confidence === "high" ||
    item.sourceIds.some((id) => !provenance.autoSourceIds.has(id)) ||
    (!!item.acceptedFromProposalId && provenance.personAccepted.has(item.acceptedFromProposalId))
  );
}

/**
 * True when the patch would replace or remove something a person wrote. An `add` only fills an
 * empty slot or appends (an add over a value set meanwhile goes stale in acceptOne). Values with
 * no provenance (logo variants, plain word lists) count as written by a person.
 */
export function overwritesHandEdit(
  state: DraftState,
  patch: JsonPatch,
  field: FieldDef,
  provenance: Provenance,
): boolean {
  const last = patch.at(-1);
  if (!last || last.op === "add") return false;
  const current = getAt(state, last.path) as Record<string, unknown> | undefined;
  if (current === undefined) return false;
  // The value every identity starts with (the "sans-serif" font tokens) is nobody's work.
  if (deepEqual(current, getAt({ document: emptyDocument(), tokens: defaultTokens() }, last.path)))
    return false;
  const written =
    field.shape === "token-group"
      ? (current.$extensions as { forgecy?: Record<string, unknown> } | undefined)?.forgecy
      : field.shape === "sourced" || field.shape === "sourced-list"
        ? current
        : undefined;
  if (!written) return true;
  return isHandEdited(
    {
      sourceIds: Array.isArray(written.sourceIds) ? (written.sourceIds as string[]) : [],
      confidence: typeof written.confidence === "string" ? written.confidence : "",
      ...(typeof written.acceptedFromProposalId === "string"
        ? { acceptedFromProposalId: written.acceptedFromProposalId }
        : {}),
    },
    provenance,
  );
}

/** The client's auto-read sources and the proposals people accepted by hand. */
async function provenanceOf(tx: BrandTx, clientId: string): Promise<Provenance> {
  const sources = await tx
    .select({ id: brandSources.id, kind: brandSources.kind })
    .from(brandSources)
    .where(and(eq(brandSources.clientId, clientId), isNull(brandSources.removedAt)));
  const accepted = await tx
    .select({ id: auditEvents.entityId })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.clientId, clientId),
        eq(auditEvents.entity, "brand_identity_proposal"),
        eq(auditEvents.action, "brand.proposal.accept"),
      ),
    );
  return {
    autoSourceIds: new Set(sources.filter((s) => AUTO_IMPORT_KINDS.has(s.kind)).map((s) => s.id)),
    personAccepted: new Set(accepted.flatMap((a) => (a.id ? [a.id] : []))),
  };
}

const notApplied = (reason: AutoNotAppliedReason): AutoImportResult => ({
  accepted: 0,
  skippedHandEdited: 0,
  needsReview: 0,
  discarded: 0,
  published: false,
  reason,
});

/** The person behind the run, with what they may do on this client; a reason when they may not. */
async function requester(
  db: Database,
  clientId: string,
  requestedBy: string | null,
): Promise<Extract<Actor, { type: "user" }> | AutoNotAppliedReason> {
  // Anything but a user id (an agent name, garbage from a payload) is nobody.
  if (typeof requestedBy !== "string" || !UUID.test(requestedBy)) return "no_requester";
  const actor = await userActor(db, requestedBy);
  if (!actor) return "no_requester";
  // A deactivated person reaches no client: the same reason as one without access.
  if (!actor.active || !canAccessClient(actor, clientId)) return "no_access";
  if (!NEEDED.every((p) => can(actor, p, clientId))) return "no_permission";
  return actor;
}

const lockClient = (tx: BrandTx, clientId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`brand_auto_import:${clientId}`}))`);

/**
 * Publishes the open draft acknowledging exactly the checks open on it, so the stored
 * acknowledged_checks list what was open. Runs in a savepoint: a refusal leaves the caller's
 * transaction usable.
 */
async function publishAcknowledged(
  tx: BrandTx,
  actor: Extract<Actor, { type: "user" }>,
  input: Omit<PublishInput, "acknowledged">,
  meta: Record<string, unknown>,
): Promise<PublishResult> {
  const attempt = (acknowledged: string[]) =>
    tx.transaction((sp) => publishDraft(sp, actor, { ...input, acknowledged }, { meta }));
  try {
    return await attempt([]);
  } catch (err) {
    if (!(err instanceof ForgecyError) || err.details?.code !== "CHECKS-NOT-ACKNOWLEDGED")
      throw err;
    return attempt(err.details.missing as string[]);
  }
}

/**
 * Kept to letters, digits and `._@/-`: a source title is page data, and the changelog is exported.
 * Stored in English (audit, export); the versions page shows it in the reader's language.
 */
export function changelogFor(titles: readonly string[]): string {
  const clean = titles
    .map((t) =>
      t
        .replace(/[^A-Za-z0-9._@/-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, TITLE_MAX),
    )
    .filter(Boolean);
  return (
    clean.length
      ? englishMessage("brand.import.version.changelog", { sources: clean.join(", ") })
      : englishMessage("brand.import.version.changelogPublic")
  ).slice(0, CHANGELOG_MAX);
}

/** The state a proposal would be applied to: the open draft, else what a new draft would copy. */
async function currentState(tx: BrandTx, clientId: string): Promise<DraftState> {
  const row =
    (await lockOpenDraft(tx, clientId)) ??
    (
      await tx
        .select()
        .from(brandIdentityVersions)
        .where(
          and(
            eq(brandIdentityVersions.clientId, clientId),
            eq(brandIdentityVersions.status, "published"),
          ),
        )
    )[0];
  return row
    ? { document: parseDocument(row.document), tokens: row.tokens as TokenTree }
    : { document: emptyDocument(), tokens: defaultTokens() };
}

/**
 * Someone else's work is in the draft: it is in review, or a person other than the requester
 * created or edited it. Drafts opened by a proposal have no creator. `editorIds` lists everyone
 * who changed the draft (edits and accepts), so it is the signal for a colleague's edits.
 */
export function isSharedDraft(
  draft: { status: string; createdBy: string | null; editorIds: string[] },
  requester: string,
): boolean {
  return (
    draft.status !== "draft" ||
    (draft.createdBy !== null && draft.createdBy !== requester) ||
    draft.editorIds.some((id) => id !== requester)
  );
}

/**
 * Accepts the run's pending proposals into the draft and publishes it, in one transaction, as
 * the person who started the run. Without that person, or when they may not do it on this
 * client, nothing is written and the proposals stay pending (`reason` says why). What needs a
 * person stays pending too: a field another source or person also proposes, a sensitive field
 * in conflict or with low confidence. When the draft holds someone else's work, or cannot be
 * published, the accepted items stay in the draft (`reason` says why).
 */
export async function applyImport(db: Database, input: AutoImportInput): Promise<AutoImportResult> {
  const actor = await requester(db, input.clientId, input.requestedBy);
  if (typeof actor === "string") return notApplied(actor);
  const { clientId, runId } = input;

  return db.transaction(async (tx) => {
    // One import at a time per client, then the draft (the order every draft writer uses).
    await lockClient(tx, clientId);
    await lockOpenDraft(tx, clientId);
    const pending = await tx
      .select({
        id: brandIdentityProposals.id,
        runId: brandIdentityProposals.runId,
        authorType: brandIdentityProposals.authorType,
        fieldPath: brandIdentityProposals.fieldPath,
        changes: brandIdentityProposals.changes,
        evidence: brandIdentityProposals.evidence,
        sensitive: brandIdentityProposals.sensitive,
        confidence: brandIdentityProposals.confidence,
        modelConfidence: brandIdentityProposals.modelConfidence,
        createdAt: brandIdentityProposals.createdAt,
      })
      .from(brandIdentityProposals)
      .where(
        and(
          eq(brandIdentityProposals.clientId, clientId),
          eq(brandIdentityProposals.status, "proposed"),
        ),
      );
    const ours = (p: (typeof pending)[number]) => p.runId === runId && p.authorType === "agent";
    const rows = pending.filter(ours);
    // Fields someone else proposes too (a brand book, a person, another run): theirs to settle.
    const contested = new Set(
      pending
        .filter((p) => !ours(p))
        .map((p) => p.fieldPath)
        .filter((f) => !f.endsWith("/-")),
    );
    const conflicting = new Set((await conflictsFor(tx, clientId)).flatMap((g) => g.proposalIds));
    const sourceIds = [...new Set(rows.flatMap((r) => r.evidence.map((e) => e.sourceId)))];
    const sources = sourceIds.length
      ? await tx
          .select({ id: brandSources.id, kind: brandSources.kind, title: brandSources.title })
          .from(brandSources)
          .where(
            and(
              eq(brandSources.clientId, clientId),
              inArray(brandSources.id, sourceIds),
              isNull(brandSources.removedAt),
            ),
          )
      : [];
    const byId = new Map(sources.map((s) => [s.id, s]));
    // Only proposals resting on public pages apply themselves. Within the run, when two values
    // compete for a field, the one the model was surer of goes first and the other goes stale.
    const eligible = rows
      .filter(
        (r) =>
          r.evidence.length > 0 &&
          r.evidence.every((e) => {
            const kind = byId.get(e.sourceId)?.kind;
            return !!kind && AUTO_IMPORT_KINDS.has(kind);
          }),
      )
      .sort(
        (a, b) =>
          // A color role names a palette color: it goes after the colors, or its alias is unresolved.
          Number(a.fieldPath.startsWith(SEMANTIC)) - Number(b.fieldPath.startsWith(SEMANTIC)) ||
          (b.modelConfidence ?? -1) - (a.modelConfidence ?? -1) ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      );

    let accepted = 0;
    let skippedHandEdited = 0;
    let needsReview = 0;
    let discarded = 0;
    const used = new Set<string>();
    const provenance = await provenanceOf(tx, clientId);
    for (const p of eligible) {
      // What a person must settle (the cases acceptOne asks a note for) is left to a person.
      if (
        contested.has(p.fieldPath) ||
        (p.sensitive && (p.confidence === "low" || conflicting.has(p.id)))
      ) {
        needsReview++;
        continue;
      }
      const [now] = await tx
        .select({ status: brandIdentityProposals.status })
        .from(brandIdentityProposals)
        .where(eq(brandIdentityProposals.id, p.id));
      if (now?.status !== "proposed") {
        if (now?.status === "stale") discarded++; // an earlier one took the same field
        continue;
      }
      const match = matchField(p.fieldPath.replace(/\[.*\]$/, "").replace(/\/-$/, ""));
      const state = await currentState(tx, clientId);
      if (
        match &&
        isJsonPatch(p.changes) &&
        overwritesHandEdit(state, p.changes, match.field, provenance)
      ) {
        await tx
          .update(brandIdentityProposals)
          .set({
            status: "rejected",
            reviewedBy: actor.id,
            reviewedAt: new Date(),
            reviewNote: HAND_EDITED_NOTE,
          })
          .where(eq(brandIdentityProposals.id, p.id));
        await recordAuditEvent(tx, {
          actor,
          action: "brand.proposal.reject",
          entity: "brand_identity_proposal",
          entityId: p.id,
          clientId,
          meta: { field: p.fieldPath, auto: true, runId, reason: "hand_edited" },
        });
        skippedHandEdited++;
        continue;
      }
      try {
        // acceptOne opens the draft when there is none, inside the savepoint: a refused
        // proposal leaves no empty draft behind.
        const r = await tx.transaction((sp) =>
          acceptOne(sp, actor, { clientId, proposalId: p.id }, false, { runId }),
        );
        if (r.status === "accepted") {
          accepted++;
          p.evidence.forEach((e) => used.add(e.sourceId));
        } else discarded++;
      } catch (err) {
        // A value the draft refuses stays pending for a person; anything else is a real failure.
        if (!(err instanceof ForgecyError && ["validation", "conflict"].includes(err.code)))
          throw err;
        discarded++;
      }
    }

    const counts = { accepted, skippedHandEdited, needsReview, discarded };
    if (!accepted) return { ...counts, published: false };
    const draft = (await lockOpenDraft(tx, clientId))!;
    if (isSharedDraft(draft, actor.id))
      return { ...counts, published: false, reason: "draft_shared" as const };
    try {
      const pub = await publishAcknowledged(
        tx,
        actor,
        {
          clientId,
          versionId: draft.id,
          rev: draft.rev,
          changelog: changelogFor([...used].map((id) => byId.get(id)!.title)),
          note: englishMessage("brand.import.version.note"),
        },
        { auto: true, runId, ...counts },
      );
      return { ...counts, published: true, versionId: pub.versionId };
    } catch (err) {
      if (!(err instanceof ForgecyError && err.code === "validation")) throw err;
      return { ...counts, published: false, reason: "not_publishable" as const };
    }
  });
}

const NOT_APPLIED: ReadonlySet<string> = new Set(["no_requester", "no_access", "no_permission"]);

/** The lines the source status shows about an automatic import. */
export function autoImportStatus(result: AutoImportResult): MessageRef[] {
  if (result.reason && NOT_APPLIED.has(result.reason))
    return [messageRef("brand.import.status.autoNotApplied", { reason: result.reason })];
  const refs: MessageRef[] = [];
  if (result.accepted)
    refs.push(
      messageRef("brand.import.status.autoApplied", {
        accepted: result.accepted,
        published: result.published ? "yes" : "no",
      }),
    );
  if (result.skippedHandEdited)
    refs.push(messageRef("brand.import.status.autoKept", { count: result.skippedHandEdited }));
  if (result.needsReview)
    refs.push(messageRef("brand.import.status.autoNeedsReview", { count: result.needsReview }));
  if (result.reason)
    refs.push(messageRef("brand.import.status.autoNotPublished", { reason: result.reason }));
  return refs;
}

function undoConflict(key: "undoNotCurrent" | "undoNotAutomatic" | "undoNoPrevious"): never {
  throw localizedError("conflict", `brand.errors.${key}`);
}

/** The `brand.version.publish` entry an automatic import wrote for this version, if any. */
async function autoPublishEvent(db: Pick<Database, "select">, clientId: string, versionId: string) {
  const [event] = await db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.clientId, clientId),
        eq(auditEvents.entity, "brand_identity_version"),
        eq(auditEvents.entityId, versionId),
        eq(auditEvents.action, "brand.version.publish"),
        sql`${auditEvents.meta}->>'auto' = 'true'`,
      ),
    )
    .limit(1);
  return event;
}

/**
 * "Undo import": the version an automatic import published goes back to the one before it,
 * restored as a new draft and published by this person. Only the current version, only when an
 * automatic import published it, only when there is an earlier one. An open draft is replaced
 * only with `replaceDraft` (the person confirmed, as for "Restore as draft").
 */
export async function undoImport(
  db: Database,
  actor: Actor,
  input: { clientId: string; versionId: string; replaceDraft?: boolean },
): Promise<PublishResult> {
  if (actor.type !== "user") throw new PermissionDeniedError("publish", actor);
  for (const p of NEEDED) assertCan(actor, p, input.clientId);
  return db.transaction(async (tx) => {
    await lockClient(tx, input.clientId);
    const [current] = await tx
      .select()
      .from(brandIdentityVersions)
      .where(
        and(
          eq(brandIdentityVersions.id, input.versionId),
          eq(brandIdentityVersions.clientId, input.clientId),
        ),
      );
    if (!current) throw localizedError("not_found", "brand.errors.versionNotFound");
    if (current.status !== "published") undoConflict("undoNotCurrent");
    const event = await autoPublishEvent(tx, input.clientId, current.id);
    if (!event) undoConflict("undoNotAutomatic");
    const previousNumber = (event.meta as { previous?: number | null }).previous;
    const [previous] =
      typeof previousNumber === "number"
        ? await tx
            .select()
            .from(brandIdentityVersions)
            .where(
              and(
                eq(brandIdentityVersions.brandIdentityId, current.brandIdentityId),
                eq(brandIdentityVersions.number, previousNumber),
              ),
            )
        : [];
    if (!previous) undoConflict("undoNoPrevious");
    const draft = await restoreDraft(tx, actor, {
      clientId: input.clientId,
      versionId: previous.id,
      replaceDraft: input.replaceDraft ?? false,
    });
    return publishAcknowledged(
      tx,
      actor,
      {
        clientId: input.clientId,
        versionId: draft.id,
        rev: draft.rev,
        changelog: englishMessage("brand.import.version.undoChangelog", {
          version: current.number,
        }),
        note: englishMessage("brand.import.version.undoNote"),
      },
      // Said explicitly: a person's undo is never taken for an automatic publish.
      { auto: false, undoOf: current.number },
    );
  });
}

export interface LatestAutoImport {
  versionId: string;
  number: number;
  at: Date;
  accepted: number;
  skippedHandEdited: number;
  discarded: number;
  /** Proposals the run left pending for a person (the review queue). */
  needsReview: number;
  /** Still the published version: "Undo import" applies to it. */
  current: boolean;
  /** A version came before it: false on a first import, which "Undo import" cannot undo. */
  previous: boolean;
  /** A person undid it: version `by` restores version `restores` (the one before the import). */
  undone?: { by: number; restores: number };
}

/** The last version an automatic import published for this client, or null. */
export async function latestAutoImport(
  db: Database,
  actor: Actor,
  clientId: string,
): Promise<LatestAutoImport | null> {
  assertCan(actor, "view", clientId);
  const [event] = await db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.clientId, clientId),
        eq(auditEvents.entity, "brand_identity_version"),
        eq(auditEvents.action, "brand.version.publish"),
        sql`${auditEvents.meta}->>'auto' = 'true'`,
      ),
    )
    .orderBy(desc(auditEvents.at), desc(auditEvents.id))
    .limit(1);
  if (!event?.entityId) return null;
  const [version] = await db
    .select({ status: brandIdentityVersions.status })
    .from(brandIdentityVersions)
    .where(
      and(
        eq(brandIdentityVersions.id, event.entityId),
        eq(brandIdentityVersions.clientId, clientId),
      ),
    );
  const meta = event.meta as Record<string, unknown>;
  const n = (k: string) => (typeof meta[k] === "number" ? (meta[k] as number) : 0);
  const [undo] = await db
    .select({ meta: auditEvents.meta })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.clientId, clientId),
        eq(auditEvents.entity, "brand_identity_version"),
        eq(auditEvents.action, "brand.version.publish"),
        sql`${auditEvents.meta}->>'undoOf' = ${String(n("number"))}`,
      ),
    )
    .orderBy(desc(auditEvents.at), desc(auditEvents.id))
    .limit(1);
  const by = (undo?.meta as { number?: unknown } | undefined)?.number;
  return {
    versionId: event.entityId,
    number: n("number"),
    at: event.at,
    accepted: n("accepted"),
    skippedHandEdited: n("skippedHandEdited"),
    discarded: n("discarded"),
    needsReview: n("needsReview"),
    current: version?.status === "published",
    previous: typeof meta.previous === "number",
    ...(typeof by === "number" && typeof meta.previous === "number"
      ? { undone: { by, restores: meta.previous } }
      : {}),
  };
}
