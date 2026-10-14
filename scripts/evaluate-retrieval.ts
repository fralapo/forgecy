import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

type Example = { id: string; category: string; passage: string; query: string };
type Hit = { source_id: string; source_title: string; source_url: string | null; chunk_ordinal: number; excerpt: string; relevance: number };
type Rank = { rank: number; reciprocalRank: number; recallAt3: number };

async function embedInBatches(texts: string[], embedTexts: (batch: string[]) => Promise<number[][]>, batchSize = 32) {
  const embeddings: number[][] = [];
  for (let offset = 0; offset < texts.length; offset += batchSize) {
    embeddings.push(...await embedTexts(texts.slice(offset, offset + batchSize)));
  }
  return embeddings;
}

function rankingMetrics(ranks: Rank[]) {
  return {
    mrr: ranks.reduce((sum, item) => sum + item.reciprocalRank, 0) / ranks.length,
    recallAt3: ranks.reduce((sum, item) => sum + item.recallAt3, 0) / ranks.length,
  };
}

async function main() {
  const examples = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/retrieval-eval.json"), "utf8")) as Example[];
  const { embedLocalTexts, LOCAL_EMBEDDING_MODEL_ID, LOCAL_EMBEDDING_MODEL_REVISION } = await import("../lib/local-embeddings");
  const { fuseKnowledgeHits, knowledgeQueryContainsIdentifier, knowledgeQueryFromQuestion } = await import("../lib/knowledge-search");
  const vectors = await embedInBatches([...examples.map(example => example.passage), ...examples.map(example => example.query)], embedLocalTexts);
  const passages = vectors.slice(0, examples.length);
  const queries = vectors.slice(examples.length);
  const fts = new Database(":memory:");
  fts.exec("CREATE VIRTUAL TABLE source_chunk_fts USING fts5(chunk_id UNINDEXED, source_id UNINDEXED, title, body, tokenize='unicode61 remove_diacritics 2')");
  const insert = fts.prepare("INSERT INTO source_chunk_fts(chunk_id,source_id,title,body) VALUES(?,?,?,?)");
  examples.forEach((example, index) => insert.run(String(index), example.id, "", example.passage));
  const lexicalSearch = fts.prepare(`SELECT chunk_id,source_id,(-bm25(source_chunk_fts,0,0,4.0,1.0)) relevance
    FROM source_chunk_fts WHERE source_chunk_fts MATCH ?
    ORDER BY bm25(source_chunk_fts,0,0,4.0,1.0),CAST(chunk_id AS INTEGER) LIMIT 20`);

  const results = examples.map((example, index) => {
    const lexicalQuery = knowledgeQueryFromQuestion(example.query);
    const lexical: Hit[] = lexicalQuery
      ? (lexicalSearch.all(lexicalQuery) as Array<{ chunk_id: string; source_id: string; relevance: number }>).map(row => ({
        source_id: row.source_id, source_title: "Evaluation fixture", source_url: null,
        chunk_ordinal: 0, excerpt: examples[Number(row.chunk_id)].passage, relevance: row.relevance,
      }))
      : [];
    const semantic: Hit[] = passages.map((vector, passageIndex) => ({
      source_id: examples[passageIndex].id, source_title: "Evaluation fixture", source_url: null,
      chunk_ordinal: 0, excerpt: examples[passageIndex].passage,
      relevance: vector.reduce((sum, value, dimension) => sum + value * queries[index][dimension], 0),
    })).sort((a, b) => b.relevance - a.relevance);
    const hybrid = fuseKnowledgeHits(lexical, semantic, 8, knowledgeQueryContainsIdentifier(example.query) ? 3 : 1);
    const rank = (hits: Hit[]): Rank => {
      const index = hits.findIndex(hit => hit.source_id === example.id);
      const value = index < 0 ? 0 : index + 1;
      return { rank: value, reciprocalRank: value ? 1 / value : 0, recallAt3: value > 0 && value <= 3 ? 1 : 0 };
    };
    return {
      id: example.id,
      category: example.category,
      lexical: rank(lexical),
      semantic: rank(semantic),
      hybrid: rank(hybrid),
    };
  });
  fts.close();

  const strategies = ["lexical", "semantic", "hybrid"] as const;
  const categories = [...new Set(results.map(result => result.category))].map(category => {
    const items = results.filter(result => result.category === category);
    return { category, count: items.length, ...Object.fromEntries(strategies.map(strategy => [strategy, rankingMetrics(items.map(item => item[strategy]))])) };
  });

  console.log(JSON.stringify({
    model: `${LOCAL_EMBEDDING_MODEL_ID}@${LOCAL_EMBEDDING_MODEL_REVISION}`,
    corpus: "annotated public-safe fixture: synthetic examples plus Bosch, Vaillant, and USAG Italian price catalogs",
    count: results.length,
    ...Object.fromEntries(strategies.map(strategy => [strategy, rankingMetrics(results.map(item => item[strategy]))])),
    categories,
    ranks: results.map(({ id, category, lexical, semantic, hybrid }) => ({ id, category, lexical: lexical.rank, semantic: semantic.rank, hybrid: hybrid.rank })),
  }, null, 2));
}

void main().catch(error => {
  console.error("Retrieval evaluation failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
