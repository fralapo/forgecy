# Installazione locale e sincronizzazione

Forgecy è un'applicazione single-user eseguita sul computer. Database, file caricati, preferenze AI e attività in coda sono locali. Ogni installazione usa le credenziali API del proprietario; non richiede un servizio Forgecy o un database remoto. OpenRouter, Meta e Google Drive ricevono solo le richieste necessarie alle funzioni che abiliti.

## Requisiti e primo avvio

Installa Node.js **22.18 o successivo**, poi dalla cartella del progetto esegui:

```sh
npm install
cp .env.example .env.local
npm run dev
```

Durante `npm install` Forgecy abilita controlli Git locali: i commit e i push vengono bloccati se le modifiche contengono formati noti di credenziali. La CI esegue anche Gitleaks sulla cronologia e `npm run security:scan` sui file tracciati. I controlli mostrano il percorso e il tipo di credenziale rilevato, mai il valore. `.env.local` è escluso da Git.

Apri `http://localhost:3000`. Il server si lega all'interfaccia loopback per impostazione predefinita. Non esporre Forgecy su una rete pubblica: è un'app personale locale, senza autenticazione multiutente.

Il database è creato automaticamente e aggiornato all'avvio. Percorsi predefiniti:

| Sistema | Cartella dati |
| --- | --- |
| macOS | `~/Library/Application Support/Forgecy` |
| Windows | `%LOCALAPPDATA%\Forgecy` |
| Linux | `$XDG_DATA_HOME/forgecy` oppure `~/.local/share/forgecy` |

La cartella contiene `forgecy.sqlite`, i file privati, lo stato Drive e, se il portachiavi del sistema non è disponibile, le credenziali protette dai permessi locali. `FORGECY_DATA_DIR` permette di usare una cartella personalizzata. Mantieni il database attivo su un disco locale: non aprirlo da Google Drive, Dropbox, NAS o cartelle di rete.

## Chiavi dei provider

Apri **Impostazioni** nell'app, anche prima di creare il primo cliente, incolla la chiave OpenRouter e premi **Verifica e salva chiave**. Forgecy la prova con OpenRouter prima di conservarla nel portachiavi del sistema operativo; se il portachiavi non è disponibile, la salva nella cartella dati privata con permessi limitati al tuo utente. La chiave non viene esportata né sincronizzata su Drive. In alternativa, puoi configurarla in `.env.local`, che non va mai aggiunto a Git:

| Variabile | Uso |
| --- | --- |
| `OPENROUTER_API_KEY` | Alternativa alla configurazione dalle Impostazioni; chiave personale per cataloghi e generazione testo e immagini. |
| `OPENROUTER_MODEL` | Modello testo di ripiego se non è impostato un modello nelle preferenze locali. Il valore predefinito è DeepSeek Flash Latest. |
| `OPENROUTER_SITE_URL` | Identificativo facoltativo inviato nei metadati OpenRouter. |
| `APP_ORIGIN` | Origine esatta locale, necessaria con `npm run start`; esempio `http://localhost:3000`. |
| `GOOGLE_DRIVE_CLIENT_ID` | Facoltativo; OAuth Client ID Google di tipo applicazione desktop, richiesto solo per Drive. |
| `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`, `META_GRAPH_VERSION` | Facoltativi, per collegare un account Instagram Professional. |
| `TOKEN_ENCRYPTION_KEY_BASE64` | Chiave casuale per cifrare i token social salvati localmente. |
| `ENABLE_WEBSITE_INGEST` | Facoltativa; l'importazione dei siti è attiva per impostazione predefinita. Imposta `false` per disabilitarla. |

Non usare il prefisso `NEXT_PUBLIC_` per chiavi private. Per generare una chiave di cifratura Meta, esegui `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` e copia l'output solo nel `.env.local` di quel computer.

Nelle **Impostazioni → OCR e lettura dei documenti** puoi scegliere **Automatico**, **Solo parser locale** o **OpenRouter**. Forgecy estrae sempre localmente il testo già incorporato nei PDF. Per scansioni e immagini, Automatico raccomanda il parser locale solo su piattaforme idonee con il modello già installato; altrimenti sceglie OpenRouter. **Solo locale** è rigoroso: se il parser manca o fallisce, il file resta in sospeso e non viene inviato all'API. OpenRouter usa il modello visivo scelto; il parser Mistral OCR costa circa 0,002 USD per pagina, oltre ai token. I PDF OCR sono limitati a 40 pagine e fino a 8 immagini inoltrate al modello. L'OCR locale non invia il file a un servizio OCR; l'estrazione strutturata dei campi catalogo è una fase AI separata e può inviare testo e immagini a OpenRouter.

Il parser locale usa PaddleOCR-VL, Python 3.12 isolato e `uv`; servono circa 8 GB liberi per runtime e modelli. **Controlla versione** verifica l'ultima release stabile; l'aggiornamento automatico è attivo di default e controlla quando Forgecy è in uso. Ogni versione viene scaricata in un ambiente separato, sottoposta a un'inferenza di prova e attivata soltanto se il test riesce. Se `uv` non è disponibile, installalo seguendo la [guida ufficiale](https://docs.astral.sh/uv/getting-started/installation/) e riapri Impostazioni.

## Configurare Google Drive

Drive è una destinazione di snapshot opzionale. L'integrazione usa OAuth per applicazioni native con PKCE e callback loopback `127.0.0.1`; non richiede un client secret nel progetto. Forgecy richiede lo scope `drive.file`, crea una cartella visibile `Forgecy` e accede ai file creati o aperti con l'app. Non può leggere l'intero Drive.

1. Apri [Google Cloud Console](https://console.cloud.google.com/) e crea o seleziona un progetto personale.
2. In **APIs & Services → Library**, abilita **Google Drive API**.
3. Configura **Google Auth Platform**: branding e audience secondo il tuo account. Se l'app è External e resta in stato **Testing**, aggiungi il tuo account come test user.
4. In **Clients**, crea un OAuth client di tipo **Desktop app** e copia il Client ID.
5. Inserisci `GOOGLE_DRIVE_CLIENT_ID=...` nel `.env.local` e riavvia Forgecy.
6. Apri **Impostazioni → Collega Google Drive**, scegli l'account Google e approva il consenso. I token sono conservati nel portachiavi di macOS/Windows/Linux quando disponibile; altrimenti Forgecy usa un file nella cartella dati con permessi privati.
7. Premi **Sincronizza adesso** dopo il lavoro e prima di passare a un altro computer. Sul secondo computer installa Forgecy, configura un OAuth client (può essere lo stesso Client ID desktop), collega lo stesso Drive e sincronizza. Un workspace vuoto scarica automaticamente l'unico ramo remoto.

Google può revocare i refresh token quando l'utente rimuove l'accesso o quando il client OAuth cambia. Per un'app External lasciata in Testing, Google documenta la scadenza dei refresh token dopo sette giorni quando vengono richiesti scope oltre ai soli profili base; se il token scade, ricollega Drive. La pubblicazione/verification dell'app OAuth dipende dall'audience e dagli scope configurati nel tuo progetto Google.

### Come Forgecy evita conflitti e perdita dati

Ogni sincronizzazione crea uno ZIP autonomo con un'immagine coerente di SQLite, gli allegati e un manifest con versione e hash. I file non vengono aggiornati o cancellati per sovrascrittura: Drive conserva snapshot separati con hash del contenuto, hash del genitore e ID dispositivo. Forgecy calcola i rami non discendenti per rilevare divergenze. In caso di conflitto puoi aprire uno snapshot Drive, salvando prima il locale in `conflicts/`, oppure caricare il locale come ramo separato.

Il flusso è pensato per usare un solo computer alla volta. Sincronizza prima di passare all'altro; non esiste un merge automatico né la modifica simultanea dello stesso workspace. Gli snapshot remoti occupano spazio nel tuo Drive e vanno eliminati manualmente da quella cartella quando non servono più. La cronologia delle revisioni Drive non è usata come archivio, perché Google non garantisce che tutte le revisioni restino disponibili.

## Esportare e importare

In **Impostazioni**, usa **Esporta archivio** per scaricare un backup `.forgecy.zip`, oppure **Importa archivio** su un'altra installazione. L'import sostituisce il workspace corrente dopo i controlli e conserva un backup locale in `pre-restore`. Puoi cancellare o copiare questi backup dalla cartella dati usando gli strumenti del sistema operativo. Proteggi gli archivi: contengono il database e i documenti del workspace, anche se Forgecy rimuove i token dei social durante l'export.

I workspace delle versioni precedenti non vengono convertiti automaticamente dal nuovo runtime. Prima di abbandonare una vecchia installazione, conserva una copia dei suoi dati e file; l'archivio `.forgecy.zip` della nuova versione è il formato supportato per trasferimenti e backup. Il progetto personale convertito durante lo sviluppo non conteneva record di lavoro o allegati.

## Build locale

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run start
```

Per `npm run start`, imposta `APP_ORIGIN=http://localhost:3000`. Il worker locale delle attività AI viene avviato con il server e non richiede cron, token di servizio o un processo database separato.

## Risoluzione problemi

| Sintomo | Cosa controllare |
| --- | --- |
| Cataloghi o generazione AI non disponibili | `OPENROUTER_API_KEY`, connessione Internet e saldo/limiti del tuo account OpenRouter. |
| Errore SQLite o disco pieno | Chiudi Forgecy, controlla spazio e permessi della cartella dati; fai una copia prima di intervenire sul database. |
| Drive non configurato | Verifica `GOOGLE_DRIVE_CLIENT_ID`, API Drive abilitata e riavvio del server locale. |
| OAuth Drive rifiutato | Controlla audience, stato Testing e lista test user nella Google Cloud Console. |
| Token Drive scaduto | Ricollega l'account dalle Impostazioni. |
| Conflitto Drive | Scegli uno dei rami remoti oppure conserva il locale come ramo separato; nessuno viene unito automaticamente. |
| Impossibile usare l'app su un altro dispositivo | Esporta un archivio oppure collega Drive, sincronizza sul primo computer e poi sul secondo. |
