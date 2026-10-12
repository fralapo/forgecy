/** Labels of the content module, shared by pages and server messages. */
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
  awareness: "Awareness",
  education: "Education",
  conversion: "Conversion",
  community: "Community",
};

export const funnelLabels: Record<FunnelStage, string> = {
  awareness: "Awareness",
  consideration: "Consideration",
  conversion: "Conversion",
  loyalty: "Loyalty",
};

export const strategyStatusLabels: Record<StrategyItemStatus, string> = {
  proposed: "Proposed",
  accepted: "Accepted",
  rejected: "Rejected",
  stale: "Needs review",
  archived: "Archived",
};

export const planStatusLabels: Record<ContentPlanStatus, string> = {
  proposed: "Proposed",
  active: "In use",
  superseded: "Superseded",
};

export const contentStatusLabels: Record<ContentStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
  exported: "Exported",
  archived: "Archived",
};

export const assetStatusLabels: Record<AssetStatus, string> = {
  draft: "To approve",
  approved: "Approved",
  rejected: "Rejected",
};

export const channelLabels: Record<ContentChannel, string> = {
  instagram: "Instagram",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  tiktok: "TikTok",
};

export const frequencyUnitLabels = { week: "per week", month: "per month" } as const;

export const agentLabels = {
  planner: "Planner",
  copywriter: "Copywriter",
  art_director: "Art Director",
} as const;

export function frequencyLabel(f: { count: number; unit: "week" | "month" } | null | undefined) {
  return f ? `${f.count} ${frequencyUnitLabels[f.unit]}` : "—";
}

/** Brand Guard coherence bands: only the band is shown, never the number (UX spec 12.6). */
export const guardBandLabels: Record<
  "critico" | "debole" | "discreto" | "buono" | "eccellente",
  string
> = {
  critico: "Critical",
  debole: "Weak",
  discreto: "Fair",
  buono: "Good",
  eccellente: "Excellent",
};
