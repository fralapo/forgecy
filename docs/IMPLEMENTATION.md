# Architettura Forgecy

Forgecy è una web app locale single-user. Next.js serve l'interfaccia solo su loopback; SQLite è il database autorevole, i file sono nella cartella dati privata e un worker nello stesso processo esegue la coda AI. I provider sono facoltativi e usano le credenziali locali dell'utente. La configurazione completa è in [LOCAL_SETUP.md](LOCAL_SETUP.md).

## Struttura

- `lib/local-db/` contiene schema e adattatore SQLite, vincoli, query e operazioni atomiche per job, quote e ricerca.
- `lib/local-files.ts` e `app/api/local-files/` conservano gli allegati in locale e li servono con URL firmati a breve durata.
- `lib/local-worker.ts` processa i job persistenti; `instrumentation.ts` lo avvia nel runtime Node quando parte il server.
- `lib/sync/archive.ts` crea e valida archivi portabili con backup SQLite coerente, manifest, hash e file del workspace.
- `lib/sync/local-backups.ts` gestisce archivi periodici configurabili e la loro rotazione. Le cartelle cloud si sincronizzano tramite il client installato sul computer; Forgecy non integra il login OAuth Drive.
- `proxy.ts` limita il server alle richieste loopback e protegge le mutazioni da richieste cross-origin.

Il runtime corrente non richiede autenticazione remota, account condivisi, database ospitato, job scheduler o servizio cloud di Forgecy. Le preferenze dei modelli OpenRouter sono locali: ogni installazione configura la propria chiave e seleziona i propri modelli.

## Dati e ripristino

SQLite usa foreign key, WAL, `synchronous=FULL` e timeout limitato. Lo schema viene inizializzato localmente. Le modifiche operative non sono sincronizzate come file SQLite live: l'export usa l'API di backup, raccoglie gli allegati e calcola gli hash. I profili Instagram memorizzati non contengono credenziali o cookie.

Prima di importare un archivio, Forgecy controlla ZIP, versione, percorsi, dimensioni, hash, integrità del database e foreign key. Il ripristino prepara i file in una directory temporanea e conserva il precedente workspace in `pre-restore`.

## Verifica

Esegui `npm run typecheck`, `npm run lint`, `npm test` e `npm run build`. I test locali coprono schema e vincoli SQLite, query, coda, backup, archivi, storage e validazione. Le chiamate reali a OpenRouter richiedono credenziali proprie; la sincronizzazione cloud dipende dal client desktop configurato dall'utente.
