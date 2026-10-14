import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { rankTarget, rankingMetrics } from "./retrieval-eval-metrics";

loadEnvConfig(process.cwd());

type Example = { id: string; category: string; passage: string; query: string; source_url?: string | null };
type Candidate = {id:string;passage:string;source_url:string|null};
type Hit = { source_id: string; source_title: string; source_url: string | null; chunk_ordinal: number; excerpt: string; relevance: number };

async function embedInBatches(texts: string[], embedTexts: (batch: string[]) => Promise<number[][]>, batchSize = 32) {
  const embeddings: number[][] = [];
  for (let offset = 0; offset < texts.length; offset += batchSize) {
    embeddings.push(...await embedTexts(texts.slice(offset, offset + batchSize)));
  }
  return embeddings;
}

async function main() {
  const examples = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/retrieval-eval.json"), "utf8")) as Example[];
  const distractors = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/retrieval-eval-candidates.json"), "utf8")) as Candidate[];
  const catalogTargets = examples.filter(example => example.category.startsWith("catalog-"));
  if (catalogTargets.some(example => !example.source_url)) throw new Error("Every public catalog target must include a source URL");
  const candidates:Candidate[]=[...examples.map(({id,passage,source_url})=>({id,passage,source_url:source_url??null})),...distractors];
  if(new Set(candidates.map(candidate=>candidate.id)).size!==candidates.length)throw new Error("Retrieval fixture contains duplicate candidate IDs");
  const distractorsBySource=distractors.reduce<Record<string,number>>((counts,candidate)=>{
    const source=candidate.source_url??"unsourced";
    counts[source]=(counts[source]??0)+1;
    return counts;
  },{});
  const { embedLocalTexts, LOCAL_EMBEDDING_MODEL_ID, LOCAL_EMBEDDING_MODEL_REVISION } = await import("../lib/local-embeddings");
  const { fuseKnowledgeHits, IDENTIFIER_LEXICAL_WEIGHT, knowledgeQueryContainsIdentifier, knowledgeQueryFromQuestion } = await import("../lib/knowledge-search");
  const vectors = await embedInBatches([...candidates.map(candidate => candidate.passage), ...examples.map(example => example.query)], embedLocalTexts);
  const passages = vectors.slice(0, candidates.length);
  const queries = vectors.slice(candidates.length);
  const fts = new Database(":memory:");
  fts.exec("CREATE VIRTUAL TABLE source_chunk_fts USING fts5(chunk_id UNINDEXED, source_id UNINDEXED, title, body, tokenize='unicode61 remove_diacritics 2')");
  const insert = fts.prepare("INSERT INTO source_chunk_fts(chunk_id,source_id,title,body) VALUES(?,?,?,?)");
  candidates.forEach((candidate, index) => insert.run(String(index), candidate.id, "", candidate.passage));
  const lexicalSearch = fts.prepare(`SELECT chunk_id,source_id,(-bm25(source_chunk_fts,0,0,4.0,1.0)) relevance
    FROM source_chunk_fts WHERE source_chunk_fts MATCH ?
    ORDER BY bm25(source_chunk_fts,0,0,4.0,1.0),CAST(chunk_id AS INTEGER) LIMIT 20`);

  const results = examples.map((example, index) => {
    const lexicalQuery = knowledgeQueryFromQuestion(example.query);
    const lexical: Hit[] = lexicalQuery
      ? (lexicalSearch.all(lexicalQuery) as Array<{ chunk_id: string; source_id: string; relevance: number }>).map(row => ({
        source_id: row.source_id, source_title: "Evaluation fixture", source_url: candidates[Number(row.chunk_id)].source_url,
        chunk_ordinal: 0, excerpt: candidates[Number(row.chunk_id)].passage, relevance: row.relevance,
      }))
      : [];
    const semantic: Hit[] = passages.map((vector, passageIndex) => ({
      source_id: candidates[passageIndex].id, source_title: "Evaluation fixture", source_url: candidates[passageIndex].source_url,
      chunk_ordinal: 0, excerpt: candidates[passageIndex].passage,
      relevance: vector.reduce((sum, value, dimension) => sum + value * queries[index][dimension], 0),
    })).sort((a, b) => b.relevance - a.relevance);
    const hybrid = fuseKnowledgeHits(lexical, semantic, 8, knowledgeQueryContainsIdentifier(example.query) ? IDENTIFIER_LEXICAL_WEIGHT : 1);
    return {
      id: example.id,
      category: example.category,
      lexical: rankTarget(lexical, example.id, example.source_url),
      semantic: rankTarget(semantic, example.id, example.source_url),
      hybrid: rankTarget(hybrid, example.id, example.source_url),
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
    corpus: `public-safe fixture: ${examples.length} annotated queries over ${candidates.length} passages, including ${Object.values(distractorsBySource).reduce((sum,count)=>sum+count,0)} sourced distractors across ${Object.keys(distractorsBySource).length} public sources`,
    distractorsBySource,
    count: results.length,
    candidateCount:candidates.length,
    annotatedCatalogTargets: catalogTargets.length,
    catalogTargetsWithSources: catalogTargets.filter(example => Boolean(example.source_url)).length,
    ...Object.fromEntries(strategies.map(strategy => [strategy, rankingMetrics(results.map(item => item[strategy]))])),
    categories,
    ranks: results.map(({ id, category, lexical, semantic, hybrid }) => ({ id, category, lexical: lexical.rank, semantic: semantic.rank, hybrid: hybrid.rank })),
  }, null, 2));
}

void main().catch(error => {
  console.error("Retrieval evaluation failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
