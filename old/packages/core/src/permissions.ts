/**
 * Permissions live in code (spec: "Users, roles and flows" and Brand Identity
 * governance). Every human user holds every content permission, but only on the
 * clients they may access (ADR 0020); settings permissions need the Admin flag.
 * AI agents can only view and propose, and that invariant is enforced here, server
 * side, whatever the caller asks.
 */
export const contentPermissions = [
  "view",
  "propose",
  "edit_draft",
  "review",
  "approve",
  "publish",
  "archive",
  "project.edit",
  "brand_identity.propose",
  "brand_identity.approve",
  "templates.manage",
  "assets.upload",
  "reports.export",
  "memory.approve",
  "products.manage",
] as const;

export const adminPermissions = [
  "settings.manage",
  "users.manage",
  "ai.providers.manage",
  "ai.budgets.manage",
  "ai.policies.manage",
  "system.backup",
  "system.update",
  "clients.transfer",
  "agents.configure",
] as const;

export type ContentPermission = (typeof contentPermissions)[number];
export type AdminPermission = (typeof adminPermissions)[number];
export type Permission = ContentPermission | AdminPermission;

export const agentRoles = [
  "strategist",
  "brand_analyst",
  "art_director",
  "copywriter",
  "reviewer",
  /** v1: creative direction of a carousel and consistency across its slides. */
  "creative_director",
] as const;
export type AgentRole = (typeof agentRoles)[number];

/**
 * The clients a person may see and work on (ADR 0020): every client, or the ids assigned
 * to them in `client_access`. Admins always reach every client whatever this says. The
 * list is read once when the actor is built (`loadClientScope` in @forgecy/db), so `can()`
 * stays synchronous and pure.
 */
export type ClientScope = "all" | readonly string[];

export type Actor =
  | { type: "user"; id: string; isAdmin: boolean; active: boolean; clients: ClientScope }
  | { type: "agent"; role: AgentRole; runId?: string };

/** The only permissions an agent can ever hold. */
export const AGENT_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  "view",
  "propose",
  "brand_identity.propose",
]);

const ADMIN_SET: ReadonlySet<Permission> = new Set<Permission>(adminPermissions);

/**
 * Whether the actor may see and work on this client (ADR 0020). Admins reach every client,
 * other people only the ones in their scope. Agents are not checked here: they only act
 * inside a job a person started, and that person's access was checked where they started it.
 */
export function canAccessClient(actor: Actor, clientId: string): boolean {
  if (actor.type === "agent") return true;
  if (!actor.active) return false;
  if (actor.isAdmin || actor.clients === "all") return true;
  return actor.clients.includes(clientId);
}

/**
 * The permission check. With a `clientId` it also requires access to that client, so a
 * `clientId` only ever narrows the answer (core.test.ts pins it). Without one it answers
 * for the action alone: lists must still filter by `clientScopeWhere` (@forgecy/db).
 */
export function can(actor: Actor, permission: Permission, clientId?: string): boolean {
  if (actor.type === "agent") return AGENT_PERMISSIONS.has(permission);
  if (!actor.active) return false;
  if (clientId !== undefined && !canAccessClient(actor, clientId)) return false;
  if (ADMIN_SET.has(permission)) return actor.isAdmin;
  return true;
}

export class PermissionDeniedError extends Error {
  readonly code = "permission_denied";
  constructor(
    readonly permission: Permission,
    readonly actor: Actor,
  ) {
    super(`Permission denied: ${permission}`);
    this.name = "PermissionDeniedError";
  }
}

export function assertCan(actor: Actor, permission: Permission, clientId?: string): void {
  if (!can(actor, permission, clientId)) throw new PermissionDeniedError(permission, actor);
}

/**
 * The same actor with one more client in its scope: for the rest of a request that has just
 * created the client and assigned it to this person (`grantClientAccess` in @forgecy/db).
 */
export function actorWithClient<A extends Actor>(actor: A, clientId: string): A {
  if (actor.type !== "user" || actor.clients === "all" || actor.clients.includes(clientId))
    return actor;
  return { ...actor, clients: [...actor.clients, clientId] };
}

/** Throws unless the actor may access this client (any permission it holds then applies). */
export function assertClientAccess(actor: Actor, clientId: string): void {
  if (!canAccessClient(actor, clientId)) throw new PermissionDeniedError("view", actor);
}
