/**
 * Shared guards of the content module. Every service function checks the actor
 * first: agents can only propose, and only people decide (spec "Governance").
 */
import {
  assertCan,
  ForgecyError,
  PermissionDeniedError,
  type Actor,
  type Permission,
} from "@forgecy/core";
import { clients, eq, type Database } from "@forgecy/db";

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Executor = Database | Tx;

export type HumanActor = Extract<Actor, { type: "user" }>;

/** An agent never edits, decides, approves or archives; people need the permission too. */
export function humanOnly(
  actor: Actor,
  permission: Permission,
  clientId?: string,
): asserts actor is HumanActor {
  if (actor.type !== "user") throw new PermissionDeniedError(permission, actor);
  assertCan(actor, permission, clientId);
}

export const userIdOf = (actor: Actor) => (actor.type === "user" ? actor.id : null);

export function conflict(message: string, details?: Record<string, unknown>): never {
  throw new ForgecyError("conflict", message, details);
}
export function notFound(message: string): never {
  throw new ForgecyError("not_found", message);
}
export function invalid(message: string, details?: Record<string, unknown>): never {
  throw new ForgecyError("validation", message, details);
}

/** Stale autosave: the spec's CONFLICT-DRAFT-REV, with who and when changed it last. */
export function revConflict(details: Record<string, unknown> = {}): never {
  conflict("Someone else changed this item while you were editing it too.", {
    code: "CONFLICT-DRAFT-REV",
    ...details,
  });
}

export async function requireClient(db: Executor, clientId: string) {
  const [client] = await db
    .select({
      id: clients.id,
      name: clients.name,
      slug: clients.slug,
      status: clients.status,
      aiPolicy: clients.aiPolicy,
      archivedAt: clients.archivedAt,
    })
    .from(clients)
    .where(eq(clients.id, clientId));
  if (!client) notFound("Client not found");
  return client;
}

interface Issue {
  path: PropertyKey[];
  message: string;
}

export function zodIssues(error: { issues: Issue[] }) {
  return error.issues.slice(0, 10).map((i) => ({
    path: i.path.map(String).join("."),
    message: i.message,
  }));
}

type SafeParse<T> = { success: true; data: T } | { success: false; error: { issues: Issue[] } };

/** Parse with a schema or throw a validation error carrying the first issues. */
export function parseOrThrow<T>(
  schema: { safeParse(v: unknown): SafeParse<T> },
  value: unknown,
): T {
  const r = schema.safeParse(value);
  if (!r.success)
    invalid(r.error.issues[0]?.message ?? "Invalid data", { issues: zodIssues(r.error) });
  return r.data;
}
