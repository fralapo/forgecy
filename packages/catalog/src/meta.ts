import type { ConfidenceLevel, ProductSourceKind } from "@forgecy/core";
import type { ClaimKind } from "./sensitive";
import type { FieldKey } from "./fields";

/** Exact origin of a value: "CSV riga 42, colonna desc", "PDF listino p. 7"... */
export interface SourceRef {
  kind: ProductSourceKind;
  /** Import file id, when the value comes from a file. */
  fileId?: string;
  fileName?: string;
  /** 1-based data row number in the sheet (header excluded = row 2 of the file). */
  row?: number;
  column?: string;
  page?: number;
  /** Agent run / job that proposed it. */
  jobId?: string;
  /** User who typed it. */
  userId?: string;
  userName?: string;
  importId?: string;
}

/** Truth level per field: Observed (extracted, not reviewed), Proposed, Approved. */
export type TruthLevel = "observed" | "proposed" | "approved";

export interface FieldMeta {
  truth: TruthLevel;
  source: SourceRef;
  confidence: ConfidenceLevel;
  /** Claim kinds found in the value; such fields are accepted one by one. */
  sensitive?: ClaimKind[];
  /** Set when a person accepted the sensitive value. */
  acceptedBy?: string;
  acceptedAt?: string;
  acceptNote?: string;
  updatedAt?: string;
}

export type FieldMetaMap = Partial<Record<FieldKey, FieldMeta>>;

export function describeSource(s: SourceRef): string {
  switch (s.kind) {
    case "csv":
    case "xlsx": {
      const label = s.kind === "csv" ? "CSV" : "XLSX";
      const where = [s.row ? `riga ${s.row}` : "", s.column ? `colonna "${s.column}"` : ""]
        .filter(Boolean)
        .join(", ");
      return `${label}${s.fileName ? ` · ${s.fileName}` : ""}${where ? ` · ${where}` : ""}`;
    }
    case "pdf":
      return `PDF${s.fileName ? ` · ${s.fileName}` : ""}${s.page ? ` p. ${s.page}` : ""}`;
    case "image":
      return `Immagine${s.fileName ? ` ${s.fileName}` : ""}`;
    case "text":
      return `Testo${s.fileName ? ` · ${s.fileName}` : ""}`;
    case "ai":
      return "Proposto da Brand Analyst";
    case "manual":
      return s.userName ? `Inserito a mano da ${s.userName}` : "Inserito a mano";
  }
}

export const confidenceLabels: Record<ConfidenceLevel, string> = {
  high: "Alta",
  medium: "Media",
  low: "Bassa",
};

export const truthLabels: Record<TruthLevel, string> = {
  observed: "Estratto, non rivisto",
  proposed: "Proposto",
  approved: "Approvato",
};

const RANK: Record<ConfidenceLevel, number> = { low: 0, medium: 1, high: 2 };

export function lowestConfidence(levels: ConfidenceLevel[]): ConfidenceLevel {
  if (levels.length === 0) return "low";
  return levels.reduce((a, b) => (RANK[a] <= RANK[b] ? a : b));
}

/**
 * Confidence from the source: structured sheets and folder names are High, an
 * official PDF read by AI Medium, AI guesses Low unless the files are official.
 */
export function confidenceFor(
  kind: ProductSourceKind,
  opts: { official?: boolean; aiConfidence?: ConfidenceLevel } = {},
): ConfidenceLevel {
  if (kind === "csv" || kind === "xlsx" || kind === "manual") return "high";
  if (kind === "text") return opts.official ? "high" : "medium";
  if (opts.aiConfidence) {
    if (opts.official) return opts.aiConfidence;
    return opts.aiConfidence === "high" ? "medium" : "low";
  }
  return opts.official ? "medium" : "low";
}
