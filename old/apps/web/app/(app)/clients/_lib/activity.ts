/**
 * How a row of `audit_events` is shown in a client's activity: which area of the
 * product it belongs to, which verb describes it and where it links. Pure functions,
 * shared by the client overview and the activity page.
 */
import { agentRoles, type AgentRole } from "@forgecy/core";

export const activityAreas = [
  "client",
  "audit",
  "brand",
  "content",
  "products",
  "templates",
  "settings",
  "other",
] as const;
export type ActivityArea = (typeof activityAreas)[number];

const areaByEntity: Record<string, ActivityArea> = {
  client: "client",
  audit: "audit",
  audit_competitor: "audit",
  audit_finding: "audit",
  audit_report: "audit",
  brand_identity_version: "brand",
  brand_identity_proposal: "brand",
  brand_source: "brand",
  content: "content",
  asset: "content",
  product: "products",
  product_import: "products",
  template: "templates",
  ai_provider: "settings",
  user: "settings",
};

export function activityArea(entity: string): ActivityArea {
  return areaByEntity[entity] ?? "other";
}

/** Entities of an area, for filtering the query. */
export function entitiesOf(area: ActivityArea): string[] {
  return Object.entries(areaByEntity)
    .filter(([, a]) => a === area)
    .map(([e]) => e);
}

export const activityObjects = [
  "client",
  "audit",
  "audit_competitor",
  "audit_finding",
  "audit_report",
  "brand_identity_version",
  "brand_identity_proposal",
  "brand_source",
  "content",
  "asset",
  "product",
  "product_import",
  "template",
  "other",
] as const;
export type ActivityObject = (typeof activityObjects)[number];

export function activityObject(entity: string): ActivityObject {
  return (activityObjects as readonly string[]).includes(entity)
    ? (entity as ActivityObject)
    : "other";
}

export const activityVerbs = [
  "created",
  "added",
  "edited",
  "deleted",
  "removed",
  "archived",
  "restored",
  "reopened",
  "approved",
  "rejected",
  "submitted",
  "published",
  "accepted",
  "proposed",
  "converted",
  "started",
  "completed",
  "cancelled",
  "exported",
  "imported",
  "confirmed",
  "skipped",
  "assigned",
  "ignored",
  "acknowledged",
  "analyzed",
  "duplicated",
  "generated",
  "updated",
] as const;
export type ActivityVerb = (typeof activityVerbs)[number];

const verbByToken: Record<string, ActivityVerb> = {
  create: "created",
  created: "created",
  add: "added",
  update: "edited",
  edit: "edited",
  edited: "edited",
  change: "edited",
  rescan: "started",
  delete: "deleted",
  remove: "removed",
  unlink: "removed",
  archive: "archived",
  restore: "restored",
  reopened: "reopened",
  approve: "approved",
  approved: "approved",
  reject: "rejected",
  rejected: "rejected",
  submit: "submitted",
  publish: "published",
  published: "published",
  accept: "accepted",
  accepted: "accepted",
  propose: "proposed",
  proposed: "proposed",
  convert: "converted",
  start: "started",
  started: "started",
  complete: "completed",
  completed: "completed",
  cancel: "cancelled",
  export: "exported",
  import: "imported",
  confirm: "confirmed",
  confirmed: "confirmed",
  skip: "skipped",
  assign: "assigned",
  ignore: "ignored",
  ignored: "ignored",
  acknowledged: "acknowledged",
  analyzed: "analyzed",
  duplicate: "duplicated",
};

/**
 * Verb of an action key such as `brand.version.submit`, `product_import_started` or
 * `audit.ai.diagnose`. The last known word wins; AI steps read as "generated".
 */
export function activityVerb(action: string): ActivityVerb {
  if (/(^|\.)ai\./.test(action)) return "generated";
  const tokens = action.split(/[._]/);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const verb = verbByToken[tokens[i] ?? ""];
    if (verb) return verb;
  }
  return "updated";
}

export type ActivityActor =
  | { kind: "person"; userId: string | null }
  | { kind: "agent"; role: AgentRole | null }
  | { kind: "system" };

/** `actor` is "user:<id>", "agent:<role>" or "system" (see recordAuditEvent). */
export function parseActor(actor: string, actorUserId: string | null): ActivityActor {
  if (actor.startsWith("agent:")) {
    const role = actor.slice("agent:".length);
    return {
      kind: "agent",
      role: (agentRoles as readonly string[]).includes(role) ? (role as AgentRole) : null,
    };
  }
  if (actor.startsWith("user:")) return { kind: "person", userId: actorUserId };
  return { kind: "system" };
}

/** Agents never create anything directly: what they produce is a proposal. */
export function actorVerb(actor: ActivityActor, verb: ActivityVerb): ActivityVerb {
  return actor.kind === "agent" && (verb === "created" || verb === "added") ? "proposed" : verb;
}

/** Decisions only people take: an agent shown as their author is an anomaly. */
const humanOnly: ReadonlySet<ActivityVerb> = new Set(["approved", "published", "archived"]);

export function isAnomaly(actor: ActivityActor, verb: ActivityVerb): boolean {
  return actor.kind === "agent" && humanOnly.has(verb);
}

/** Page of the object an event is about, when it can be derived from the event alone. */
export function activityHref(
  clientSlug: string,
  entity: string,
  entityId: string | null,
): string | null {
  switch (entity) {
    case "client":
      return `/clients/${clientSlug}`;
    case "audit":
    case "audit_competitor":
    case "audit_finding":
      return `/audit/${clientSlug}`;
    case "audit_report":
      return `/audit/${clientSlug}/report`;
    case "brand_identity_version":
      return `/brand/${clientSlug}/versions`;
    case "brand_identity_proposal":
      return `/brand/${clientSlug}/proposals`;
    case "brand_source":
      return `/brand/${clientSlug}/sources`;
    case "content":
      return entityId
        ? `/content/${clientSlug}/carousels/${entityId}`
        : `/content/${clientSlug}/carousels`;
    case "asset":
      return `/content/${clientSlug}/library`;
    case "product":
      return entityId ? `/products/${clientSlug}/${entityId}` : `/products/${clientSlug}`;
    case "product_import":
      return entityId
        ? `/products/${clientSlug}/import/${entityId}/review`
        : `/products/${clientSlug}`;
    case "template":
      return entityId ? `/templates/${entityId}` : "/templates";
    default:
      return null;
  }
}

export const actorKinds = ["person", "agent", "system"] as const;
export type ActorKind = (typeof actorKinds)[number];
export const activityPeriods = ["today", "7d", "30d"] as const;
export type ActivityPeriod = (typeof activityPeriods)[number];
export const filterAreas = activityAreas.filter(
  (a): a is Exclude<ActivityArea, "other"> => a !== "other",
);

export const PAGE_SIZE = 50;
const MAX_LIMIT = 1000;

export interface ActivityFilters {
  actorType: ActorKind | null;
  area: Exclude<ActivityArea, "other"> | null;
  period: ActivityPeriod | null;
  limit: number;
}

const pick = <T extends string>(list: readonly T[], value: unknown): T | null =>
  typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T) : null;

/** Filters from the query string; unknown values are dropped. */
export function parseActivityFilters(
  sp: Record<string, string | string[] | undefined>,
): ActivityFilters {
  const rawLimit = typeof sp.limit === "string" ? Number.parseInt(sp.limit, 10) : PAGE_SIZE;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(MAX_LIMIT, Math.max(PAGE_SIZE, Math.ceil(rawLimit / PAGE_SIZE) * PAGE_SIZE))
    : PAGE_SIZE;
  return {
    actorType: pick(actorKinds, sp.actorType),
    area: pick(filterAreas, sp.area),
    period: pick(activityPeriods, sp.period),
    limit,
  };
}

/** Start of the period: midnight (server clock) for `today`, else 7 or 30 days back. */
export function periodStart(period: ActivityPeriod, now: Date = new Date()): Date {
  if (period === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const days = period === "7d" ? 7 : 30;
  return new Date(now.getTime() - days * 86_400_000);
}

/** Query string for a set of filters (empty values left out). */
export function activityQuery(f: Partial<ActivityFilters>): string {
  const p = new URLSearchParams();
  if (f.actorType) p.set("actorType", f.actorType);
  if (f.area) p.set("area", f.area);
  if (f.period) p.set("period", f.period);
  if (f.limit && f.limit > PAGE_SIZE) p.set("limit", String(f.limit));
  const s = p.toString();
  return s ? `?${s}` : "";
}
