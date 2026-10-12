import type { Actor } from "@forgecy/core";
import type { Database } from "@forgecy/db";

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** A database handle or an open transaction. */
export type DbLike = Database | Tx;

/** Who acts: always a person for decisions; agents only reach `propose`. */
export interface ActingUser {
  actor: Actor;
  id: string;
  name: string;
}

export function actorUserId(actor: Actor): string | null {
  return actor.type === "user" ? actor.id : null;
}
