/**
 * Permissions live in code (spec: "Users, roles and flows" and Brand Identity
 * governance). In the MVP every human user holds every content permission;
 * settings permissions need the Admin flag. AI agents can only view and propose,
 * and that invariant is enforced here, server side, whatever the caller asks.
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
] as const;
export type AgentRole = (typeof agentRoles)[number];

export type Actor =
  | { type: "user"; id: string; isAdmin: boolean; active: boolean }
  | { type: "agent"; role: AgentRole; runId?: string };

/** The only permissions an agent can ever hold. */
export const AGENT_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  "view",
  "propose",
  "brand_identity.propose",
]);

const ADMIN_SET: ReadonlySet<Permission> = new Set<Permission>(adminPermissions);

/**
 * `clientId` is accepted now so call sites are already scoped; per-client grants
 * (permission_grants) arrive in v1 without changing the signature.
 */
export function can(actor: Actor, permission: Permission, _clientId?: string): boolean {
  if (actor.type === "agent") return AGENT_PERMISSIONS.has(permission);
  if (!actor.active) return false;
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
