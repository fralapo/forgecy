import "server-only";
import { listProposals } from "@forgecy/brand";
import { getDb } from "@forgecy/db";
import type { Actor } from "@forgecy/core";

/** Pending proposals per field pointer, for the badges of the block pages. */
export async function pendingByField(
  actor: Actor,
  clientId: string,
): Promise<Record<string, number>> {
  const rows = await listProposals(getDb(), actor, clientId, { status: "proposed" });
  const out: Record<string, number> = {};
  for (const p of rows) {
    const key = p.fieldPath.replace(/\[.*\]$/, "").replace(/\/-$/, "");
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}
