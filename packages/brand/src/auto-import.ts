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
  asc,
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
import { localizedError, messageRef } from "@forgecy/i18n";
import { parseDocument } from "./document";
import { matchField, type FieldDef } from "./fields";
import { getAt, isJsonPatch, type JsonPatch } from "./json-patch";
import { sourceRank, type DraftState } from "./proposals";
import {
  acceptOne,
  lockOpenDraft,
  openDraft,
  publishDraft,
  restoreDraft,
  type BrandTx,
  type PublishInput,
  type PublishResult,
} from "./service";
import type { TokenTree } from "./tokens";

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
const AUTO_NOTE = "Automatic import";
const HAND_EDITED_NOTE = "hand-edited field kept";
const CHANGELOG_MAX = 500;

export type AutoNotAppliedReason = "no_requester" | "no_access" | "no_permission";

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
  /** Proposals that no longer apply (stale) or are invalid; invalid ones stay pending for a person. */
  discarded: number;
  published: boolean;
  versionId?: string;
  /** Why nothing was applied (proposals stay pending), or why the draft was not published. */
  reason?: AutoNotAppliedReason | "not_publishable";
}

/** A value a person typed (no cited source) or confirmed by hand (high, not from a proposal). */
export function isHandEdited(item: {
  sourceIds: string[];
  confidence: string;
  acceptedFromProposalId?: string;
}): boolean {
  return (
    item.sourceIds.length === 0 || (item.confidence === "high" && !item.acceptedFromProposalId)
  );
}

/**
 * True when the patch would replace or remove something a person wrote. An `add` only fills an
 * empty slot or appends (an add over a value set meanwhile goes stale in acceptOne). Values with
 * no provenance (logo variants, plain word lists) count as written by a person.
 */
export function overwritesHandEdit(state: DraftState, patch: JsonPatch, field: FieldDef): boolean {
  const last = patch.at(-1);
  if (!last || last.op === "add") return false;
  const current = getAt(state, last.path) as Record<string, unknown> | undefined;
  if (current === undefined) return false;
  const provenance =
    field.shape === "token-group"
      ? (current.$extensions as { forgecy?: Record<string, unknown> } | undefined)?.forgecy
      : field.shape === "sourced" || field.shape === "sourced-list"
        ? current
        : undefined;
  if (!provenance) return true;
  return isHandEdited({
    sourceIds: Array.isArray(provenance.sourceIds) ? (provenance.sourceIds as string[]) : [],
    confidence: typeof provenance.confidence === "string" ? provenance.confidence : "",
    ...(typeof provenance.acceptedFromProposalId === "string"
      ? { acceptedFromProposalId: provenance.acceptedFromProposalId }
      : {}),
  });
}

const notApplied = (reason: AutoNotAppliedReason): AutoImportResult => ({
  accepted: 0,
  skippedHandEdited: 0,
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
  if (actor.active && !canAccessClient(actor, clientId)) return "no_access";
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
 * Accepts the run's pending proposals into the draft and publishes it, in one transaction, as
 * the person who started the run. Without that person, or when they may not do it on this
 * client, nothing is written and the proposals stay pending (`reason` says why). When the draft
 * cannot be published, the accepted items stay in the draft (`reason: "not_publishable"`).
 */
export async function applyImport(db: Database, input: AutoImportInput): Promise<AutoImportResult> {
  const actor = await requester(db, input.clientId, input.requestedBy);
  if (typeof actor === "string") return notApplied(actor);
  const { clientId, runId } = input;

  return db.transaction(async (tx) => {
    // One import at a time per client, then the draft (the order every draft writer uses).
    await lockClient(tx, clientId);
    await lockOpenDraft(tx, clientId);
    const rows = await tx
      .select({
        id: brandIdentityProposals.id,
        fieldPath: brandIdentityProposals.fieldPath,
        changes: brandIdentityProposals.changes,
        evidence: brandIdentityProposals.evidence,
      })
      .from(brandIdentityProposals)
      .where(
        and(
          eq(brandIdentityProposals.clientId, clientId),
          eq(brandIdentityProposals.runId, runId),
          eq(brandIdentityProposals.authorType, "agent"),
          eq(brandIdentityProposals.status, "proposed"),
        ),
      )
      .orderBy(asc(brandIdentityProposals.createdAt));
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
    const rank = (r: (typeof rows)[number]) =>
      Math.min(...r.evidence.map((e) => sourceRank(byId.get(e.sourceId)!.kind)));
    // Only proposals resting on public pages apply themselves; the stronger source goes first, so
    // when the site and a profile disagree on a field the site's value wins and the other goes stale.
    const eligible = rows
      .filter(
        (r) =>
          r.evidence.length > 0 &&
          r.evidence.every((e) => {
            const kind = byId.get(e.sourceId)?.kind;
            return !!kind && AUTO_IMPORT_KINDS.has(kind);
          }),
      )
      .sort((a, b) => rank(a) - rank(b));

    let accepted = 0;
    let skippedHandEdited = 0;
    let discarded = 0;
    const used = new Set<string>();
    for (const p of eligible) {
      const [now] = await tx
        .select({ status: brandIdentityProposals.status })
        .from(brandIdentityProposals)
        .where(eq(brandIdentityProposals.id, p.id));
      if (now?.status !== "proposed") {
        if (now?.status === "stale") discarded++; // an earlier one took the same field
        continue;
      }
      const match = matchField(p.fieldPath.replace(/\[.*\]$/, "").replace(/\/-$/, ""));
      const draft = await openDraft(tx, clientId, actor.id);
      const state: DraftState = {
        document: parseDocument(draft.document),
        tokens: draft.tokens as TokenTree,
      };
      if (match && isJsonPatch(p.changes) && overwritesHandEdit(state, p.changes, match.field)) {
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
        const r = await tx.transaction((sp) =>
          acceptOne(sp, actor, { clientId, proposalId: p.id, note: AUTO_NOTE }, false, { runId }),
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

    const counts = { accepted, skippedHandEdited, discarded };
    if (!accepted) return { ...counts, published: false };
    const draft = (await lockOpenDraft(tx, clientId))!;
    const titles = [...used].map((id) => byId.get(id)!.title).join(", ");
    try {
      const pub = await publishAcknowledged(
        tx,
        actor,
        {
          clientId,
          versionId: draft.id,
          rev: draft.rev,
          changelog: `Automatic import from ${titles}`.slice(0, CHANGELOG_MAX),
          note: AUTO_NOTE,
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

/** The lines the source status shows about an automatic import. */
export function autoImportStatus(result: AutoImportResult): MessageRef[] {
  if (result.reason && result.reason !== "not_publishable")
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
  if (result.reason === "not_publishable")
    refs.push(messageRef("brand.import.status.autoNotPublished"));
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
 * automatic import published it, only when there is an earlier one.
 */
export async function undoImport(
  db: Database,
  actor: Actor,
  input: { clientId: string; versionId: string },
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
      replaceDraft: true,
    });
    return publishAcknowledged(
      tx,
      actor,
      {
        clientId: input.clientId,
        versionId: draft.id,
        rev: draft.rev,
        changelog: `Undo of automatic import v${current.number}`,
        note: "Undo of automatic import",
      },
      { undoOf: current.number },
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
  /** Still the published version: "Undo import" applies to it. */
  current: boolean;
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
  return {
    versionId: event.entityId,
    number: n("number"),
    at: event.at,
    accepted: n("accepted"),
    skippedHandEdited: n("skippedHandEdited"),
    discarded: n("discarded"),
    current: version?.status === "published",
  };
}
