/** Italian labels of the content module, shared by pages and server messages. */
import type {
  AssetStatus,
  ContentObjective,
  ContentPlanStatus,
  ContentStatus,
  FunnelStage,
  StrategyItemStatus,
} from "@forgecy/core";
import type { ContentChannel } from "./document";

export const objectiveLabels: Record<ContentObjective, string> = {
  awareness: "Notorietà",
  education: "Educazione",
  conversion: "Conversione",
  community: "Community",
};

export const funnelLabels: Record<FunnelStage, string> = {
  awareness: "Consapevolezza",
  consideration: "Considerazione",
  conversion: "Conversione",
  loyalty: "Fidelizzazione",
};

export const strategyStatusLabels: Record<StrategyItemStatus, string> = {
  proposed: "Proposto",
  accepted: "Accettato",
  rejected: "Rifiutato",
  stale: "Da rivedere",
  archived: "Archiviato",
};

export const planStatusLabels: Record<ContentPlanStatus, string> = {
  proposed: "Proposto",
  active: "In uso",
  superseded: "Sostituito",
};

export const contentStatusLabels: Record<ContentStatus, string> = {
  draft: "Bozza",
  in_review: "In revisione",
  changes_requested: "Modifiche richieste",
  approved: "Approvato",
  exported: "Esportato",
  archived: "Archiviato",
};

export const assetStatusLabels: Record<AssetStatus, string> = {
  draft: "Da approvare",
  approved: "Approvata",
  rejected: "Rifiutata",
};

export const channelLabels: Record<ContentChannel, string> = {
  instagram: "Instagram",
  linkedin: "LinkedIn",
};

export const frequencyUnitLabels = { week: "a settimana", month: "al mese" } as const;

export const agentLabels = {
  planner: "Planner",
  copywriter: "Copywriter",
  art_director: "Art Director",
} as const;

export function frequencyLabel(f: { count: number; unit: "week" | "month" } | null | undefined) {
  return f ? `${f.count} ${frequencyUnitLabels[f.unit]}` : "—";
}
