/**
 * Coherence with the brand, from the rule-based findings (spec, Brand Identity tab:
 * "Nell'MVP c'è solo la coerenza, come brand check a regole"). A score is never shown
 * alone: each category carries its band and the keys of the findings behind it.
 */
import type { BrandCheckSeverity } from "@forgecy/core";
import type { BrandCheckFinding, CheckCategory, CoherenceScore, ScoreBand } from "./types";

export const CHECK_CATEGORIES: readonly CheckCategory[] = [
  "vocabulary",
  "claims",
  "editorial",
  "visual",
  "layout",
  "images",
];

export const CATEGORY_LABELS: Record<CheckCategory, string> = {
  vocabulary: "Vocabolario e regole di scrittura",
  claims: "Claim e fatti di prodotto",
  editorial: "Regole editoriali delle slide",
  visual: "Colori, font e contrasto",
  layout: "Impaginazione e safe zone",
  images: "Immagini",
};

export const PENALTY: Record<BrandCheckSeverity, number> = { error: 15, warning: 5, note: 1 };

export const BAND_LABELS: Record<ScoreBand, string> = {
  critico: "Critico",
  debole: "Debole",
  discreto: "Discreto",
  buono: "Buono",
  eccellente: "Eccellente",
};

export function scoreBand(score: number): ScoreBand {
  if (score >= 90) return "eccellente";
  if (score >= 75) return "buono";
  if (score >= 60) return "discreto";
  if (score >= 40) return "debole";
  return "critico";
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** 100 minus the penalties of the findings that count (pass only open ones). */
export function coherenceScore(
  findings: readonly Pick<BrandCheckFinding, "key" | "category" | "severity">[],
): CoherenceScore {
  const total = clamp(100 - findings.reduce((n, f) => n + PENALTY[f.severity], 0));
  return {
    score: total,
    band: scoreBand(total),
    categories: CHECK_CATEGORIES.map((category) => {
      const own = findings.filter((f) => f.category === category);
      const score = clamp(100 - own.reduce((n, f) => n + PENALTY[f.severity], 0));
      return { category, score, band: scoreBand(score), evidence: own.map((f) => f.key) };
    }),
  };
}
