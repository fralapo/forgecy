import { assertCan, type Actor } from "@forgecy/core";
import {
  and,
  auditChannelStates,
  auditMetrics,
  auditSocialPosts,
  auditSources,
  audits,
  desc,
  eq,
  recordAuditEvent,
  socialPosts,
  socialProfiles,
  type Database,
} from "@forgecy/db";
import { localizedError } from "@forgecy/i18n";
import { normalizeHandle } from "../analysis/text";
import { addProfile, requestSnapshot, userIdOf, type SocialServiceDeps } from "./profiles";
import { postFromRow } from "./rows";
import { latestProfile } from "./snapshot";

const SOURCE_LABEL = { graph_api: "Graph API", public_web: "public profile", file_import: "file" };

async function loadEditableAudit(db: Database, actor: Actor, auditId: string) {
  const [audit] = await db.select().from(audits).where(eq(audits.id, auditId));
  if (!audit) throw localizedError("not_found", "audit.errors.auditNotFound");
  assertCan(actor, "project.edit", audit.clientId);
  if (audit.status === "archived" || audit.status === "delivered")
    throw localizedError("conflict", "audit.errors.auditClosed");
  return audit;
}

const profileUrlOf = (handle: string) => `https://www.instagram.com/${handle}/`;

/**
 * "Read the profile" in an audit: follows the prospect's Instagram profile (once) and queues a
 * read that, when it finishes, fills the channel with the numbers and posts it found.
 */
export async function startAuditRead(
  deps: SocialServiceDeps,
  actor: Actor,
  input: { auditId: string; profileUrl: string },
) {
  const audit = await loadEditableAudit(deps.db, actor, input.auditId);
  const handle = normalizeHandle(input.profileUrl);
  if (!handle) throw localizedError("validation", "social.errors.invalidHandle");
  const [existing] = await deps.db
    .select()
    .from(socialProfiles)
    .where(and(eq(socialProfiles.clientId, audit.clientId), eq(socialProfiles.handle, handle)));
  const profile =
    existing ??
    (await addProfile(deps, actor, {
      clientId: audit.clientId,
      handle,
      role: "prospect",
      auditId: audit.id,
    }));
  // A profile that failed is read again when a person asks for it; a paused or stopped one stays so.
  if (profile.status === "error")
    await deps.db
      .update(socialProfiles)
      .set({ status: "pending", statusReason: null })
      .where(eq(socialProfiles.id, profile.id));
  return requestSnapshot(deps, actor, profile.id, 0, audit.id);
}

/**
 * Copies what Forgecy read into the audit as an imported source: the followers and post count as
 * dated metrics, the posts as rows. From there the audit treats it like an uploaded export (cards,
 * Brand Analyst, report), and a new read replaces the previous one. Numbers keep their date and
 * say where they came from.
 */
export async function importProfileToAudit(
  db: Database,
  actor: Actor,
  input: { auditId: string; profileId: string },
): Promise<{ posts: number }> {
  const audit = await loadEditableAudit(db, actor, input.auditId);
  const [profile] = await db
    .select()
    .from(socialProfiles)
    .where(eq(socialProfiles.id, input.profileId));
  if (!profile || profile.clientId !== audit.clientId)
    throw localizedError("not_found", "social.errors.profileNotFound");
  const snapshot = await latestProfile(db, profile.id);
  if (!snapshot) throw localizedError("not_found", "social.errors.profileNotFound");
  const posts = (
    await db
      .select()
      .from(socialPosts)
      .where(eq(socialPosts.profileId, profile.id))
      .orderBy(desc(socialPosts.postedAt))
      .limit(120)
  ).map(postFromRow);

  const observedOn = snapshot.observedAt.slice(0, 10);
  const url = profileUrlOf(profile.handle);
  const label = `@${profile.handle} · Instagram (${SOURCE_LABEL[snapshot.source]}) · ${observedOn}`;
  const userId = userIdOf(actor);

  await db.transaction(async (tx) => {
    // Cascades to the posts and metrics of the previous read of this profile.
    await tx
      .delete(auditSources)
      .where(
        and(
          eq(auditSources.auditId, audit.id),
          eq(auditSources.channel, "instagram"),
          eq(auditSources.url, url),
          eq(auditSources.method, "public_page"),
        ),
      );
    const [source] = await tx
      .insert(auditSources)
      .values({
        auditId: audit.id,
        channel: "instagram",
        kind: "file",
        method: "public_page",
        providedBy: "crawl",
        status: "collected",
        url,
        title: label,
        fileName: label,
        data: { rowsImported: posts.length, rowsSkipped: 0 },
        createdBy: userId,
      })
      .returning({ id: auditSources.id });
    const sourceId = source!.id;

    if (posts.length)
      await tx.insert(auditSocialPosts).values(
        posts.map((p, i) => ({
          auditId: audit.id,
          channel: "instagram" as const,
          sourceId,
          rowNumber: i + 1,
          postedOn: p.postedAt.slice(0, 10),
          postType: null,
          format: p.kind,
          text: p.caption,
          metrics: Object.fromEntries(
            Object.entries({ likes: p.likes, comments: p.comments, views: p.views }).filter(
              (entry): entry is [string, number] => entry[1] !== null,
            ),
          ),
        })),
      );

    // `file_import` is the source the interaction rate accepts for followers and posts together.
    const metric = (name: string, value: number | null) =>
      value === null
        ? []
        : [
            {
              auditId: audit.id,
              channel: "instagram" as const,
              metric: name,
              value,
              observedOn,
              source: "file_import" as const,
              sourceNote: label,
              sourceId,
              createdBy: userId,
            },
          ];
    const values = [
      ...metric("followers", snapshot.followers),
      ...metric("posts_total", snapshot.postsTotal),
    ];
    if (values.length) await tx.insert(auditMetrics).values(values);

    await tx
      .insert(auditChannelStates)
      .values({
        auditId: audit.id,
        channel: "instagram",
        profileUrl: url,
        status: "collected",
        updatedBy: userId,
      })
      .onConflictDoUpdate({
        target: [auditChannelStates.auditId, auditChannelStates.channel],
        set: {
          status: "collected",
          unavailableReason: null,
          unavailableRef: null,
          updatedBy: userId,
        },
      });
    await recordAuditEvent(tx, {
      actor,
      action: "audit.social.profile_read",
      entity: "audit",
      entityId: audit.id,
      clientId: audit.clientId,
      meta: {
        channel: "instagram",
        handle: profile.handle,
        posts: posts.length,
        source: snapshot.source,
      },
    });
  });
  return { posts: posts.length };
}
