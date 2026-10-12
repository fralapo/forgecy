# Forgecy — acquisizione fonti e dossier AI basato sulle evidenze (V14)

## Implementato

Questa estensione lavora **nell'applicazione Next.js attiva alla radice della repository** (non in `old/`).

1. **Sito web, 1–6 pagine**: `POST /api/workspace/clients/:id/website` con `{"url":"https://azienda.it","maxPages":5}`. Il server controlla `robots.txt`, visita la pagina iniziale e fino a cinque pagine interne pertinenti (azienda, servizi, prodotti, contatti), senza seguire link esterni.
2. **Sicurezza SSRF**: HTTPS:443, DNS pubblico verificato e usato direttamente nella connessione TLS, blocco IP literal e domini locali, redirect disabilitati, 1 MB massimo di HTML per URL, 96 KB per robots.txt, limite 6 pagine e 2 errori supplementari. Ogni nuova URL viene validata di nuovo. Serve **anche un firewall di uscita**; l'applicazione non lo sostituisce.
3. **Provenienza e aggiornamenti**: ogni pagina è una fonte `website` con URL originale, istante di acquisizione, contenuto estratto e SHA-256. Un'importazione identica non crea una nuova fonte e non invalida il dossier; se il contenuto cambia, l'aggiornamento incrementa la revisione di conoscenza e rende obsolete le analisi precedenti.
4. **Documenti privati**: la pipeline esistente accetta testo, Markdown, CSV, PDF con testo e DOCX; i file restano nel bucket Supabase privato e l'estrazione genera una fonte testuale sottoposta a RLS. I PDF scannerizzati e le immagini non ricevono OCR automatico.
5. **Social**: la connessione ufficiale Instagram per account professionali e l'importazione di metriche realmente disponibili erano già presenti. Le rilevazioni archiviate, quando esistono, entrano adesso anche nel contesto del dossier con il loro ID.
6. **AI reale**: il dossier chiama OpenRouter dal server con `response_format=json_schema`, `strict:true`, Zod e `provider.require_parameters=true`. La chiave API non viene mandata al browser. Senza credenziali, oppure se il modello non supporta lo schema, l'endpoint restituisce un errore, **mai risposte inventate**.
7. **Controlli deterministici**: per dichiarare un'affermazione `verified` l'AI deve presentare un ID di fonte del cliente e una citazione testuale esatta (almeno 12 caratteri) contenuta nella prova. Se l'ID non esiste o la citazione non coincide, la certezza viene abbassata a `inferred`. Il report è registrato in `dossiers.evidence_report`. La verifica di corrispondenza testuale **non equivale a fact-checking**: l'approvazione umana rimane obbligatoria.
8. **Concorrenza e versioni**: se il knowledge revision cambia mentre il modello lavora, il server interrompe il salvataggio e chiede di ripetere l'analisi. Il database impedisce l'approvazione di dossier obsoleti.

## Integrazione V19 — budget condivisi

La successiva migrazione `0012_website_crawl_budgets.sql` aggiunge limiti di acquisizione PostgreSQL atomici per cliente e proprietario, con risposte HTTP 429 e rifiuto totale se la prenotazione fallisce. Consulta [CRAWL_BUDGETS.md](CRAWL_BUDGETS.md).

## Requisiti per l'attivazione

1. Esegui le migrazioni Supabase in ordine da `0001` fino a **`0007_source_intelligence.sql`** nel progetto usato da Forgecy.
2. Configura `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `OPENROUTER_API_KEY` nel backend. Seleziona con `OPENROUTER_MODEL` un modello compatibile con JSON Schema strutturato.
3. Per permettere l'acquisizione web, predisponi restrizioni di **egress a livello di rete**, limitando TCP a 443 verso Internet pubblico e bloccando tutte le destinazioni private, link-local e metadata. Solo dopo imposta `ENABLE_WEBSITE_INGEST=true` nel server.
4. Per Instagram, configura `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY_BASE64`. Il proprietario deve autorizzare gli account professionali con i permessi effettivamente approvati dalla propria app Meta.
5. Avvia `npm install && npm run typecheck && npm test && npm run build`; GitHub Actions esegue anche migrazioni e test PostgreSQL.

## Endpoint

```http
POST /api/workspace/clients/:clientId/website
Content-Type: application/json

{"url":"https://azienda.example","maxPages":5}
```

Risposta: `{ source, sources, unchanged, visited, skipped, message }`. `source` resta disponibile per compatibilità; `sources` contiene tutte le nuove pagine o quelle aggiornate. Una pagina invariata viene contata in `unchanged`.

```http
POST /api/workspace/clients/:clientId/dossier/draft
Content-Type: application/json

{}
```

Produce un dossier strutturato in bozza con findings, `source_ids`, `evidence_quote`, certezza e `evidence_report`. Deve essere approvato separatamente tramite `/dossier/approve`.

## Limiti dichiarati e roadmap

- Crawl essenziale limitato a link di primo livello della home; non esegue JavaScript di siti SPA e non segue sitemap XML. `robots.txt` usa un sottoinsieme prudente di RFC 9309; non sostituisce un crawler specializzato.
- Non implementa un orchestratore durevole con job queue, sincronizzazione periodica, limiti di spesa per cliente, rate limit condiviso, OCR o browser automation. In produzione sono ancora necessari questi controlli e una revisione della sicurezza della rete.
- I dati dei social dipendono da account, permessi e campi autorizzati dalle API Meta; non si possono estrarre insight di account senza consenso.
- Un testo letto da un sito può essere falso, vecchio o fuorviante: la citazione esatta prova la **presenza nel documento**, non la verità indipendente di quanto affermato.
- Non modificare automaticamente una strategia già approvata: al variare delle fonti il dossier passa a `stale` e richiede nuova revisione.

## Riferimenti

- OpenRouter Structured Outputs: https://openrouter.ai/docs/guides/features/structured-outputs
- OWASP SSRF Prevention: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- RFC 9309 Robots Exclusion Protocol: https://www.rfc-editor.org/rfc/rfc9309.html
- Next.js Route Handlers: https://nextjs.org/docs/app/getting-started/route-handlers
