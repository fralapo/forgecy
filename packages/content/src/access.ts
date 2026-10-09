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
import {
  englishMessage,
  localizedError,
  messageRef,
  type MessageKey,
  type MessageValues,
} from "@forgecy/i18n";

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

/** Messages of the module's errors, shown in the person's language (`content.errors.*`). */
export type ContentErrorKey = Extract<MessageKey, `content.errors.${string}`>;

export function conflict(
  key: ContentErrorKey,
  details?: Record<string, unknown>,
  values?: MessageValues,
): never {
  throw localizedError("conflict", key, values, details);
}
export function notFound(key: ContentErrorKey, values?: MessageValues): never {
  throw localizedError("not_found", key, values);
}
export function invalid(
  key: ContentErrorKey,
  details?: Record<string, unknown>,
  values?: MessageValues,
): never {
  throw localizedError("validation", key, values, details);
}

const isContentKey = (message: string): message is ContentErrorKey =>
  message.startsWith("content.errors.");

/** Stale autosave: the spec's CONFLICT-DRAFT-REV, with who and when changed it last. */
export function revConflict(details: Record<string, unknown> = {}): never {
  conflict("content.errors.revConflict", {
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
      sendableAssets: clients.sendableAssets,
      archivedAt: clients.archivedAt,
    })
    .from(clients)
    .where(eq(clients.id, clientId));
  if (!client) notFound("content.errors.clientNotFound");
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
  if (!r.success) {
    const message = r.error.issues[0]?.message ?? englishMessage("content.errors.invalidData");
    const details = { issues: zodIssues(r.error) };
    // A schema message may be a key of `content.errors`; Zod's own messages stay as they are.
    if (isContentKey(message)) invalid(message, details);
    throw new ForgecyError(
      "validation",
      message,
      details,
      r.error.issues[0] ? undefined : messageRef("content.errors.invalidData"),
    );
  }
  return r.data;
}
