# Forgecy V21: integrazione incrementale del backend

## Perché
Le PR precedenti avevano introdotto due migrazioni diverse con numero **0012**. La nuova linea di integrazione parte dal lavoro V20 (PR #94), conserva il budget crawler e la ricerca a estratti e porta i controlli worker della PR #95 su una numerazione non ambigua.

## Sequenza canonica delle migrazioni
0001–0011 (base); **0012_website_crawl_budgets.sql**; **0013_source_chunks.sql**; **0014_source_chunks_backfill.sql**; **0015_ai_worker_fencing.sql**.

Non rinominare o riapplicare migrazioni già eseguite in un database di produzione senza verificarne lo stato. Questa sequenza vale per una nuova installazione e per ambienti che hanno ricevuto i numeri precedenti coerentemente. Prima del deploy, fare inventario della cronologia del database e un backup verificato.

## Che cosa si unisce
- Knowledge retrieval, chunk search e dossier con citazioni di fonti del cliente.
- Quote condivise per acquisizioni web e difese SSRF (crawling **disabilitato** senza firewall di uscita).
- AI job con token riservato al worker, rinnovo della lease, rejection dei worker scaduti.
- Rimozione del SELECT * nella lista dei job del workspace, che dopo 0015 non deve esporre `lease_token`.

## Test di accettazione
1. Typecheck, lint, test Node.
2. PostgreSQL 16: migrazioni 0001–0015, smoke test RLS, ricerca a estratti e test concorrenza worker.
3. Build Next.js.
4. Staging **da eseguire manualmente** con Supabase/OpenRouter reali, worker e Meta autorizzato; CI non dimostra l'integrazione esterna.
5. Monitorare race e processi interrotti con almeno due dispatcher concorrenti prima del rilascio.

## Limiti
Il heartbeat evita che un tentativo scaduto confermi l'esito di un altro; non rende esattamente una volta le richieste al modello e non rende atomiche tutte le azioni di ogni agente. Scheduler, egress firewall, budget token/€, OCR, token Meta e osservabilità restano da completare. Nessuna migrazione è stata applicata automaticamente a database utenti da questa PR.
