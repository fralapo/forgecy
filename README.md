# Forgecy

Forgecy è un progetto open source per uso personale. Si avvia sul proprio computer, salva il workspace in SQLite locale e usa le API configurate dal proprietario. Non esiste un account Forgecy centrale o un backend condiviso. Google Drive è facoltativo e conserva snapshot versionati per trasferire il lavoro tra computer.

## Avvio rapido

Prerequisiti: Node.js 22.18 o successivo e npm. Su macOS, Linux e Windows:

```sh
npm install
cp .env.example .env.local
npm run dev
```

Apri [http://localhost:3000](http://localhost:3000). L'app crea il database al primo avvio. Puoi aprire **Impostazioni** anche prima di creare un cliente: inserisci lì la tua chiave OpenRouter e scegli i modelli AI. In alternativa, puoi impostare `OPENROUTER_API_KEY` in `.env.local`. Consulta [Configurazione locale](docs/LOCAL_SETUP.md) per API, dati, backup e collegamento a Google Drive.

Se riprendi il progetto su un altro computer, segui la [guida per la prossima sessione](docs/NEXT_SESSION.md), che spiega come clonare il codice e trasferire separatamente il workspace locale.

Il database si trova nella cartella dati utente del sistema operativo. `FORGECY_DATA_DIR` consente di sceglierne un'altra. Le impostazioni dei modelli e i dati del workspace restano locali; ogni computer configura le proprie chiavi AI. Le statistiche Instagram si importano come snapshot JSON forniti da chi utilizza Forgecy, senza login né raccolta automatica dal sito.

## Dati e sincronizzazione

SQLite è il database attivo e non va collocato in una cartella sincronizzata. L'export crea un archivio `.forgecy.zip` con database coerente, allegati, manifest versionato e hash. L'import verifica limiti, percorsi, hash, integrità SQLite e relazioni prima di sostituire il workspace; conserva una copia locale precedente in `pre-restore`.

Per usare più computer, collega Google Drive dalle Impostazioni e sincronizza manualmente prima di cambiare dispositivo. Forgecy carica snapshot immutabili invece del file SQLite attivo. Se le copie divergono, mantiene i rami su Drive e chiede quale aprire; può salvare la copia locale come ramo separato. La sincronizzazione non è collaborazione simultanea né unione automatica dei record. Consulta la sezione Google Drive nella [guida locale](docs/LOCAL_SETUP.md).

## Sviluppo

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

La vecchia applicazione è conservata nella cartella `old/` come archivio storico e non fa parte del runtime attuale.
