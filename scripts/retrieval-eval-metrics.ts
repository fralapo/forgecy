export type RetrievalRank = {
  rank: number;
  reciprocalRank: number;
  recallAt3: number;
  citationAvailable: boolean;
  citationCoveredAt3: boolean;
};

export function rankTarget(
  hits: Array<{ source_id: string; source_url: string | null }>,
  targetId: string,
  targetSourceUrl: string | null | undefined,
): RetrievalRank {
  const index = hits.findIndex(hit => hit.source_id === targetId);
  const rank = index < 0 ? 0 : index + 1;
  const citationAvailable = Boolean(targetSourceUrl);
  return {
    rank,
    reciprocalRank: rank ? 1 / rank : 0,
    recallAt3: rank > 0 && rank <= 3 ? 1 : 0,
    citationAvailable,
    citationCoveredAt3: citationAvailable && rank > 0 && rank <= 3 && Boolean(hits[index]?.source_url),
  };
}

export function rankingMetrics(ranks: RetrievalRank[]) {
  const citedTargets = ranks.filter(item => item.citationAvailable);
  return {
    mrr: ranks.reduce((sum, item) => sum + item.reciprocalRank, 0) / ranks.length,
    recallAt3: ranks.reduce((sum, item) => sum + item.recallAt3, 0) / ranks.length,
    citationCoverageAt3: citedTargets.length
      ? citedTargets.filter(item => item.citationCoveredAt3).length / citedTargets.length
      : null,
    citedTargetCount: citedTargets.length,
  };
}
