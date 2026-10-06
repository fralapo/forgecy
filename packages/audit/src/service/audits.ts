import { createDbLedger, monthKey } from "@forgecy/ai";
import {
  ACTIVE_AUDIT_STATUSES,
  assertCan,
  AUDIT_LIMITS,
  ForgecyError,
  socialChannels,
  type Actor,
  type AiPolicy,
  type ProviderId,
} from "@forgecy/core";
import {
  and,
  auditChannelStates,
  audits,
  clients,
  desc,
  eq,
  inArray,
  prospectProfiles,
  recordAuditEvent,
  siteScans,
  type AuditInputs,
  type Database,
  type ScanStep,
} from "@forgecy/db";
import { cancelJob } from "@forgecy/jobs";
import { auditCrawlJob, auditProposeCompetitorsJob } from "../jobs";
import { normalizeSiteUrl } from "../url";
import {
  aiAllowed,
  assertEditable,
  enqueueAuditJob,
  isUniqueViolation,
  loadAudit,
  requireQueues,
  userIdOf,
  type AuditDeps,
  type Tx,
} from "./common";

/** Estimated AI cost of a full audit (UX Page 6). Shown as a range, never as a promise. */
export const AUDIT_COST_RANGE_USD = { min: 1.5, max: 2.5 } as const;

export interface AuditEstimate {
  policy: AiPolicy;
  aiAllowed: boolean;
  costRangeUsd: { min: number; max: number } | null;
  /** True when the audit runs on the local model: no API cost. */
  localModel: boolean;
  /** Budget left this month (client cap if set, else agency), null when no cap. */
  budgetLeftUsd: number | null;
  budgetBlocked: boolean;
  steps: string[];
}

/**
 * `defaultProvider` is AI_DEFAULT_PROVIDER: with the local model (or a local_only
 * policy) the audit has no API cost, so no range is shown.
 */
export async function estimateAudit(
  db: Database,
  clientId: string,
  defaultProvider?: ProviderId,
): Promise<AuditEstimate> {
  const client = await db.query.clients.findFirst({ where: eq(clients.id, clientId) });
  if (!client) throw new ForgecyError("not_found", "Prospect non trovato");
  const allowed = aiAllowed(client.aiPolicy);
  const localModel = allowed && (client.aiPolicy === "local_only" || defaultProvider === "local");
  const paid = allowed && !localModel;
  const ledger = createDbLedger(db);
  const month = monthKey();
  let budgetLeftUsd: number | null = null;
  for (const scope of [{ scope: "client" as const, clientId }, { scope: "agency" as const }]) {
    const limit = await ledger.budgetFor(scope, month);
    if (!limit) continue;
    const spent = await ledger.monthSpendMicroUsd(scope, month);
    const left = Math.max(0, (limit.limitMicroUsd - spent) / 1_000_000);
    budgetLeftUsd = budgetLeftUsd === null ? left : Math.min(budgetLeftUsd, left);
  }
  const steps = [
    client.websiteUrl
      ? `Lettura del sito: fino a ${AUDIT_LIMITS.maxPages} pagine, con screenshot desktop e mobile`
      : "Nessun sito indicato: la lettura del sito viene saltata",
    "Social: solo dati che carichi tu (screenshot, export CSV/XLSX, valori a mano)",
    allowed
      ? `Competitor: l'AI ne propone fino a ${AUDIT_LIMITS.maxCompetitors}, tu confermi la lista`
      : "Competitor: li aggiungi tu (AI disattivata dalla policy)",
    allowed
      ? "Osservazioni, confronto e diagnosi proposte dall'AI, sempre da rivedere"
      : "Osservazioni e diagnosi compilate a mano",
  ];
  return {
    policy: client.aiPolicy,
    aiAllowed: allowed,
    costRangeUsd: paid ? AUDIT_COST_RANGE_USD : null,
    localModel,
    budgetLeftUsd,
    budgetBlocked: paid && budgetLeftUsd !== null && budgetLeftUsd < AUDIT_COST_RANGE_USD.min,
    steps,
  };
}

const initialSteps = (): ScanStep[] =>
  (["robots", "discovery", "screenshots", "extraction", "checks", "analysis"] as const).map(
    (key) => ({ key, status: "pending" }),
  );

/** Insert a site_scans row and enqueue its crawl. */
export async function createScan(
  deps: AuditDeps,
  tx: Tx | Database,
  input: {
    auditId: string;
    clientId: string;
    rootUrl: string;
    competitorId?: string | null;
    createdBy: string | null;
  },
): Promise<string> {
  const [scan] = await tx
    .insert(siteScans)
    .values({
      clientId: input.clientId,
      auditId: input.auditId,
      competitorId: input.competitorId ?? null,
      rootUrl: input.rootUrl,
      status: "pending",
      maxPages: input.competitorId ? AUDIT_LIMITS.maxCompetitorPages : AUDIT_LIMITS.maxPages,
      steps: initialSteps(),
      createdBy: input.createdBy,
    })
    .returning({ id: siteScans.id });
  return scan!.id;
}

async function enqueueCrawl(
  deps: AuditDeps,
  audit: { id: string; clientId: string },
  scanId: string,
  createdBy: string | null,
) {
  const job = await enqueueAuditJob(deps, {
    def: auditCrawlJob,
    payload: { scanId },
    audit,
    createdBy,
  });
  await deps.db.update(siteScans).set({ jobId: job.id }).where(eq(siteScans.id, scanId));
  return job;
}

/**
 * Start the audit (Page 6 → "Avvia audit"): snapshot of the inputs, social channel
 * rows, the site reading. Social data is never read automatically: the channels wait
 * for screenshots or files. Without a website the audit goes straight to competitors.
 */
export async function startAudit(
  deps: AuditDeps,
  actor: Actor,
  clientId: string,
): Promise<{ auditId: string }> {
  assertCan(actor, "project.edit", clientId);
  requireQueues(deps);
  const client = await deps.db.query.clients.findFirst({ where: eq(clients.id, clientId) });
  if (!client || client.status !== "prospect")
    throw new ForgecyError("not_found", "Prospect non trovato");
  if (client.archivedAt) throw new ForgecyError("conflict", "Il prospect è archiviato.");
  const profile = await deps.db.query.prospectProfiles.findFirst({
    where: eq(prospectProfiles.clientId, clientId),
  });
  const userId = userIdOf(actor);
  const websiteUrl = client.websiteUrl ? normalizeSiteUrl(client.websiteUrl) : null;
  const inputs: AuditInputs = {
    ...(websiteUrl ? { websiteUrl } : {}),
    ...(client.sector ? { sector: client.sector } : {}),
    ...(profile?.area ? { area: profile.area } : {}),
    objectives: profile?.objectives ?? [],
    ...(profile?.otherObjective ? { otherObjective: profile.otherObjective } : {}),
    ...(client.notes ? { notes: client.notes } : {}),
    reportLanguage: profile?.reportLanguage ?? "it",
    socialUrls: profile?.socialUrls ?? {},
  };
  const allowed = aiAllowed(client.aiPolicy);

  let created: { auditId: string; scanId: string | null };
  try {
    created = await deps.db.transaction(async (tx) => {
      const [audit] = await tx
        .insert(audits)
        .values({
          clientId,
          status: websiteUrl ? "collecting" : "awaiting_competitors",
          inputs,
          ownerId: profile?.ownerId ?? userId,
          createdBy: userId,
          startedAt: new Date(),
        })
        .returning({ id: audits.id });
      const auditId = audit!.id;
      await tx.insert(auditChannelStates).values([
        {
          auditId,
          channel: "website",
          profileUrl: websiteUrl,
          status: websiteUrl ? "collecting" : "unavailable",
          unavailableReason: websiteUrl ? null : "Nessun sito indicato",
          updatedBy: userId,
        },
        ...socialChannels
          .filter((c) => inputs.socialUrls?.[c])
          .map((channel) => ({
            auditId,
            channel,
            profileUrl: inputs.socialUrls![channel]!,
            status: "pending" as const,
            updatedBy: userId,
          })),
      ]);
      const scanId = websiteUrl
        ? await createScan(deps, tx, { auditId, clientId, rootUrl: websiteUrl, createdBy: userId })
        : null;
      await recordAuditEvent(tx, {
        actor,
        action: "audit.start",
        entity: "audit",
        entityId: auditId,
        clientId,
        meta: { website: Boolean(websiteUrl), policy: client.aiPolicy },
      });
      return { auditId, scanId };
    });
  } catch (err) {
    if (isUniqueViolation(err))
      throw new ForgecyError(
        "conflict",
        "C'è già un audit in corso per questo prospect. Aprilo o archivialo prima di avviarne uno nuovo.",
      );
    throw err;
  }

  const audit = { id: created.auditId, clientId };
  if (created.scanId) await enqueueCrawl(deps, audit, created.scanId, userId);
  else if (allowed)
    await enqueueAuditJob(deps, {
      def: auditProposeCompetitorsJob,
      payload: { auditId: audit.id },
      audit,
      createdBy: userId,
    });
  return { auditId: created.auditId };
}

/** Read the site again ("Rileggi il sito"): earlier reviewed observations stay, marked as older. */
export async function rescanSite(
  deps: AuditDeps,
  actor: Actor,
  auditId: string,
): Promise<{ scanId: string }> {
  const { audit } = await loadAudit(deps.db, auditId);
  assertCan(actor, "project.edit", audit.clientId);
  assertEditable(audit);
  const rootUrl = audit.inputs.websiteUrl;
  if (!rootUrl) throw new ForgecyError("validation", "Questo audit non ha un sito da leggere.");
  const running = await deps.db
    .select({ id: siteScans.id })
    .from(siteScans)
    .where(
      and(eq(siteScans.auditId, auditId), inArray(siteScans.status, ["pending", "collecting"])),
    );
  if (running.length) throw new ForgecyError("conflict", "Una lettura del sito è già in corso.");
  const userId = userIdOf(actor);
  const scanId = await deps.db.transaction(async (tx) => {
    const id = await createScan(deps, tx, {
      auditId,
      clientId: audit.clientId,
      rootUrl,
      createdBy: userId,
    });
    await tx
      .update(auditChannelStates)
      .set({ status: "collecting", unavailableReason: null, updatedBy: userId })
      .where(
        and(eq(auditChannelStates.auditId, auditId), eq(auditChannelStates.channel, "website")),
      );
    await recordAuditEvent(tx, {
      actor,
      action: "audit.site.rescan",
      entity: "audit",
      entityId: auditId,
      clientId: audit.clientId,
    });
    return id;
  });
  await enqueueCrawl(deps, audit, scanId, userId);
  return { scanId };
}

/** Retry a failed or partial scan ("Riprova questo passo"): a fresh reading of the same URL. */
export async function retryScan(deps: AuditDeps, actor: Actor, scanId: string) {
  const scan = await deps.db.query.siteScans.findFirst({ where: eq(siteScans.id, scanId) });
  if (!scan?.auditId) throw new ForgecyError("not_found", "Lettura non trovata");
  if (!scan.competitorId) return rescanSite(deps, actor, scan.auditId);
  const { audit } = await loadAudit(deps.db, scan.auditId);
  assertCan(actor, "project.edit", audit.clientId);
  assertEditable(audit);
  const userId = userIdOf(actor);
  const id = await createScan(deps, deps.db, {
    auditId: audit.id,
    clientId: audit.clientId,
    rootUrl: scan.rootUrl,
    competitorId: scan.competitorId,
    createdBy: userId,
  });
  await enqueueCrawl(deps, audit, id, userId);
  return { scanId: id };
}

/** Stop a running reading; pages already read are kept. */
export async function cancelScan(deps: AuditDeps, actor: Actor, scanId: string): Promise<void> {
  const scan = await deps.db.query.siteScans.findFirst({ where: eq(siteScans.id, scanId) });
  if (!scan?.auditId) throw new ForgecyError("not_found", "Lettura non trovata");
  assertCan(actor, "project.edit", scan.clientId);
  if (scan.jobId) await cancelJob(deps.db, requireQueues(deps), scan.jobId);
  await deps.db
    .update(siteScans)
    .set({ status: "partial", error: "Lettura interrotta da una persona", finishedAt: new Date() })
    .where(and(eq(siteScans.id, scanId), inArray(siteScans.status, ["pending", "collecting"])));
}

/** Archive the audit (its data stays readable); a new one can then be started. */
export async function archiveAudit(deps: AuditDeps, actor: Actor, auditId: string) {
  const { audit } = await loadAudit(deps.db, auditId);
  assertCan(actor, "archive", audit.clientId);
  await deps.db.transaction(async (tx) => {
    await tx
      .update(audits)
      .set({ status: "archived", archivedAt: new Date() })
      .where(eq(audits.id, auditId));
    await recordAuditEvent(tx, {
      actor,
      action: "audit.archive",
      entity: "audit",
      entityId: auditId,
      clientId: audit.clientId,
      meta: { from: audit.status },
    });
  });
}

/** The active audit of a prospect, or the most recent one. */
export async function currentAudit(db: Database, clientId: string) {
  const rows = await db
    .select()
    .from(audits)
    .where(eq(audits.clientId, clientId))
    .orderBy(desc(audits.createdAt))
    .limit(5);
  return rows.find((a) => ACTIVE_AUDIT_STATUSES.includes(a.status)) ?? rows[0] ?? null;
}
