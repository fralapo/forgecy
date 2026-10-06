import type { Actor } from "@forgecy/core";
import type { Database } from "./client";
import { auditEvents } from "./schema";

export function actorKey(actor: Actor | "system"): string {
  if (actor === "system") return "system";
  return actor.type === "user" ? `user:${actor.id}` : `agent:${actor.role}`;
}

/** Write one activity log entry. Call it in the same transaction as the change it describes. */
export async function recordAuditEvent(
  db: Pick<Database, "insert">,
  event: {
    actor: Actor | "system";
    action: string;
    entity: string;
    entityId?: string;
    clientId?: string;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(auditEvents).values({
    actor: actorKey(event.actor),
    actorUserId: event.actor !== "system" && event.actor.type === "user" ? event.actor.id : null,
    action: event.action,
    entity: event.entity,
    entityId: event.entityId ?? null,
    clientId: event.clientId ?? null,
    meta: event.meta ?? {},
  });
}
