import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

type Example = { id: string; category: string; passage: string; query: string };
async function main() {
  const examples = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/retrieval-eval.json"), "utf8")) as Example[];
  const { embedLocalTexts, LOCAL_EMBEDDING_MODEL_ID, LOCAL_EMBEDDING_MODEL_REVISION } = await import("../lib/local-embeddings");
  const vectors = await embedLocalTexts([...examples.map(example => example.passage), ...examples.map(example => example.query)]);
  const passages = vectors.slice(0, examples.length);
  const queries = vectors.slice(examples.length);

  const results = examples.map((example, index) => {
    const ranked = passages.map((vector, passageIndex) => ({
      id: examples[passageIndex].id,
      score: vector.reduce((sum, value, dimension) => sum + value * queries[index][dimension], 0),
    })).sort((a, b) => b.score - a.score);
    const rank = ranked.findIndex(item => item.id === example.id) + 1;
    return { id: example.id, category: example.category, rank, reciprocalRank: 1 / rank, recallAt3: rank <= 3 ? 1 : 0 };
  });

  const average = (items: typeof results, field: "reciprocalRank" | "recallAt3") =>
    items.length ? items.reduce((sum, item) => sum + item[field], 0) / items.length : 0;
  const categories = [...new Set(results.map(result => result.category))].map(category => {
    const items = results.filter(result => result.category === category);
    return { category, count: items.length, mrr: average(items, "reciprocalRank"), recallAt3: average(items, "recallAt3") };
  });

  console.log(JSON.stringify({
    model: `${LOCAL_EMBEDDING_MODEL_ID}@${LOCAL_EMBEDDING_MODEL_REVISION}`,
    corpus: "synthetic, public-safe evaluation fixture",
    count: results.length,
    mrr: average(results, "reciprocalRank"),
    recallAt3: average(results, "recallAt3"),
    categories,
    ranks: results.map(({ id, category, rank }) => ({ id, category, rank })),
  }, null, 2));
}

void main().catch(error => {
  console.error("Retrieval evaluation failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
