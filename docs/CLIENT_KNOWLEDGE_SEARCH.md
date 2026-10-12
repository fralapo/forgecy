# Forgecy — Client Knowledge Search (V20)

## Purpose

A client can have hundreds of pages and documents. Sending the first 20 whole
documents to the Leader wastes tokens and often omits the relevant evidence.
This module creates **bounded, individually attributable text excerpts** and
retrieves them for the question at hand.

This is **PostgreSQL lexical full-text search**, not semantic/embedding search,
and does not itself fact-check statements found in customer documents.

## Installation and upgrade

Depends on migrations 0001–0012 from the source-intelligence branch.

1. Apply `supabase/migrations/0013_source_chunks.sql`.
2. Backfill existing ready sources by applying `0014_source_chunks_backfill.sql`.
   For a large production tenant, schedule the backfill in batches instead of
   executing it during a high-traffic window.
3. Deploy the Next.js branch after applying migrations, since the Leader's
   contextual answers now invoke the new RPC.
4. Run the usual TypeScript, Node, PostgreSQL/RLS smoke and Next build tests.
5. Validate with **two real customer accounts** before using it for confidential
   production files.

PostgreSQL stores generated simple-language tsvector tokens and a GIN index;
simple-language tokenization avoids assuming every customer writes Italian.
It is a keyword index: morphological synonyms and paraphrases can still miss.

## Data flow

```text
Source created / edited / extracted
           |
           v
source_chunks_reindex trigger
           |
           v
1700-character passages (1500-character stride, ~200 overlap)
           |
           v
GIN index + client-scoped RLS + foreign key (source_id, client_id)
           |
           +----> Biblioteca / Fonti → ricerca con titolo e passaggio
           |
           +----> Leader question → top 8 relevant snippets + source IDs
```

Only `sources.status='ready'` produces snippets. Pending, failed, edited,
and deleted documents are automatically removed or reindexed. Original source
bodies are still the authoritative records; `source_chunks` is a materialized
search index, not an additional knowledge store. No client-facing INSERT,
UPDATE or DELETE privilege is granted on the index.

Existing clients' sources are processed by the separate backfill. New sources
need no manual indexing.

## Client API

```http
GET /api/workspace/clients/{clientId}/knowledge/search?q=servizi%20retail&limit=12
```

Authenticated, RLS-scoped JSON response:

```json
{
  "query": "servizi retail",
  "mode": "lexical",
  "limit": 12,
  "hits": [
    {
      "source_id": "uuid",
      "source_title": "Servizi",
      "source_url": "https://azienda.it/servizi",
      "chunk_ordinal": 2,
      "excerpt": "Testo realmente estratto...",
      "relevance": 0.06
    }
  ]
}
```

Query length 2–200, maximum 20 results. No search without client ownership.
The database RPC is `forgecy_search_client_sources` (SECURITY INVOKER).
The Leader retrieves matching snippets in its prompt as *untrusted evidence*
with exact source IDs, while other AI actions continue to require approved
dossier/strategic gates.

The **dossier generator** also retrieves up to 16 excerpts across four independent
research topics (company/mission, products/services, audience, positioning).
This avoids privileging the first uploaded documents. After inference, every
cited source UUID is reloaded **under the selected client's authorization** and
its quoted passage is checked against the authoritative stored source body.
Unsupported references are downgraded rather than accepted as verified.

## Design limitations

- It is not an embedding model, a vector database or semantic RAG yet.
- The first 80 chunks / source are indexed (about 120k source characters;
  existing extraction limits are lower). File binaries are not indexed.
- Query terms are combined with full-text search; common stopwords are removed
  from Leader question queries to avoid overrestrictive AND matches.
- The API does not expose arbitrary SQL, file-system paths or another client's
  documents. Users must already be logged in and authorized through RLS.
- Relevance is lexical; related concepts expressed with different terminology
  can be missed. Later additions could include `pgvector`, embeddings and
  cross-encoder reranking, provided they keep tenancy and source provenance.
- Extracted text can carry prompt injection. It must remain labeled untrusted
  in prompts; a citation points to text, not necessarily a true external fact.
- The indexing trigger adds PostgreSQL writes on source updates. For very
  large tenants, an asynchronous reindex job and background backfill may be
  preferable. Existing installations should monitor GIN index growth.

## Verification

- Postgres smoke: authorized searching, denied cross-client RPC, RLS isolation,
  prevented index writes, source-edit reindex and ready/pending transitions.
- Node tests: bounded query normalization and source-bound retrieval formatting.
- GitHub CI: strict typecheck, unit tests, DB migrations, RLS and build.

## ECC methodology

Followed `affaan-m/ecc` database-migrations (schema/data separation,
production backfill caution), contract-first (stable API payload) and ordinary
test → implementation → verification practices. No ECC code was copied into
the product.

## Next iteration

Add source freshness, reviewer-verified facts, document contradictions and
entity extraction; then evaluate semantic hybrid retrieval against a fixed
set of real agency questions before adopting embeddings.

## Integration with earlier phases

This PR is based on `feature/crawl-shared-budget` (PR #93), which already contains the original source-level `forgecy_search_sources` endpoint and its indexed lexical search. The `0013` migration introduces *additional bounded source chunks* and a distinct `forgecy_search_client_sources` RPC, without deleting or renaming the previous RPC. The Library query and Leader now use chunk search. The two retrieval systems coexist safely for old clients during a staged rollout. A later refactoring may retire the original source-level RPC only after all callers are migrated and staging acceptance is successful.

**Migration ordering is deliberate:** the parent branch already uses `0010_editorial_calendar.sql`, `0011_client_evidence_search.sql` and `0012_website_crawl_budgets.sql`; never reuse these numbers for the search chunks. Apply schema `0013` before backfill `0014`.

The old PR #92 contains an earlier standalone implementation. This consolidation branch supersedes its overlapping migration numbering, and should be reviewed and merged after its prerequisite branches have landed.
