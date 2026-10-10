import type { Ctl } from "./editor-config";

/**
 * The first line a person wrote in a list entry, to label it when folded: text boxes only,
 * because a "type" menu ("claim", "proof_point") says nothing about the entry.
 */
export function entrySummary(obj: Record<string, unknown>, fields: readonly Ctl[]): string | null {
  const text = fields
    .filter((c) => c.kind === "text" || c.kind === "textarea")
    .map((c) => obj[c.key])
    .find((v): v is string => typeof v === "string" && v.trim() !== "");
  return text ? text.slice(0, 120) : null;
}
