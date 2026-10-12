import { createHash } from "node:crypto";

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export interface FieldDigest {
  sha256: string;
  bytes: number;
}

/**
 * Describe the data sent to a provider without the data itself: field names,
 * sizes and SHA-256 hashes. This is what goes into jobs_log.input_summary.
 */
export function summarizeFields(
  fields: Record<string, string | Uint8Array | null | undefined>,
): Record<string, FieldDigest> {
  const out: Record<string, FieldDigest> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    const bytes = typeof value === "string" ? Buffer.byteLength(value, "utf8") : value.byteLength;
    out[name] = { sha256: sha256(value), bytes };
  }
  return out;
}
