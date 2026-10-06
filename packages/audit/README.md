# @forgecy/audit

Audit dei prospect (M2): lettura del sito, dati social caricati a mano, competitor, confronto tra canali, diagnosi e piano di 30 giorni. Ogni osservazione cita le sue prove; l'AI propone, una persona accetta, modifica o scarta.

## Ingressi

- `@forgecy/audit`: servizi e query per l'app web (prospect, audit, osservazioni, competitor, social), definizioni dei job, parser di CSV/XLSX e metriche. Non carica Chromium.
- `@forgecy/audit/handlers`: `createAuditHandlers()` per il worker, con il crawler e le chiamate AI.

Ogni servizio riceve `(deps, actor, input)`, controlla il permesso con `assertCan` e scrive `recordAuditEvent` nella stessa transazione. Gli agenti hanno solo `view` e `propose`: scrivono proposte (`status = observed`) e non possono accettarle né scartarle.

## Job

| Job                         | Cosa fa                                                               |
| --------------------------- | --------------------------------------------------------------------- |
| `audit.crawl`               | Legge fino a 10 pagine (3 per un competitor), screenshot e controlli  |
| `audit.analyze_site`        | Osservazioni del Brand Analyst sul sito                               |
| `audit.analyze_social`      | Osservazioni su un canale, solo da metriche e post importati          |
| `audit.propose_competitors` | Lo Strategist propone 3–5 competitor da confermare                    |
| `audit.compare_competitors` | Offerta, tono e osservazioni di confronto con i competitor confermati |
| `audit.compare_channels`    | Sito, Instagram e Facebook su cinque criteri                          |
| `audit.diagnose`            | 3–5 problemi dalle osservazioni accettate                             |
| `audit.plan`                | Pilastri e piano di 30 giorni dai problemi accettati                  |

Con la policy `no_ai` nessun job AI parte: osservazioni e problemi si scrivono a mano.

## Prove e confidenza

Il modello riceve riferimenti (`P1`, `CHECK:h1`, `POST:3`, `O2`…) e deve citarli. `verifyEvidence` scarta i riferimenti inventati e tiene una citazione solo se compare parola per parola nella fonte. La confidenza viene dal numero di elementi distinti verificati, mai dal modello.

## Crawler

Rispetta sempre `robots.txt` (user agent `ForgecyAudit`), salta le pagine con login, ha un timeout per pagina e uno per l'intera lettura. Rifiuta gli indirizzi della rete locale.

| Variabile                           | Effetto                                                             |
| ----------------------------------- | ------------------------------------------------------------------- |
| `FORGECY_CHROMIUM_PATH`             | Chromium da usare; senza, lettura del solo HTML (niente screenshot) |
| `FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS` | `true` permette siti nella rete locale (intranet)                   |

## Social

Niente scraping: screenshot (solo come prova), export CSV/XLSX con mappatura delle colonne, oppure valori inseriti a mano con fonte e data. Un valore mancante resta "Non disponibile". Il tasso di interazione appare solo con follower e interazioni dalla stessa fonte.

## Test

`pnpm --filter @forgecy/audit test`. I test di integrazione dei servizi usano `FORGECY_TEST_DATABASE_URL` e `FORGECY_TEST_REDIS_URL` e vengono saltati senza.
