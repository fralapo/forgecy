import assert from "node:assert/strict";
import { test } from "node:test";
import { rankTarget, rankingMetrics } from "../../scripts/retrieval-eval-metrics";

test("citation coverage counts sourced targets missed by retrieval", () => {
  const missed = rankTarget([], "catalog-target", "https://example.test/catalog.pdf");
  const found = rankTarget([
    { source_id: "other", source_url: "https://example.test/other.pdf" },
    { source_id: "catalog-target", source_url: "https://example.test/catalog.pdf" },
  ], "catalog-target", "https://example.test/catalog.pdf");

  assert.equal(missed.citationAvailable, true);
  assert.equal(missed.citationCoveredAt3, false);
  assert.equal(found.citationCoveredAt3, true);
  assert.deepEqual(rankingMetrics([missed, found]), {
    mrr: 0.25,
    recallAt3: 0.5,
    citationCoverageAt3: 0.5,
    citedTargetCount: 2,
  });
});

test("citation coverage excludes targets without an annotated source URL", () => {
  const unsourced = rankTarget([], "synthetic-target", undefined);
  assert.equal(rankingMetrics([unsourced]).citationCoverageAt3, null);
  assert.equal(rankingMetrics([unsourced]).citedTargetCount, 0);
});
