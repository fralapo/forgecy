# Installazione locale e sincronizzazione

Forgecy è un'applicazione single-user eseguita sul computer. Database, file caricati, preferenze AI e attività in coda sono locali. Ogni installazione usa le credenziali API del proprietario; non richiede un servizio Forgecy o un database remoto. I documenti vengono inviati a OpenRouter solo per le funzioni AI che abiliti.

## Requisiti e primo avvio

Installa Node.js **22.18 o successivo**, poi dalla cartella del progetto esegui:

```sh
npm install
cp .env.example .env.local
npm run dev
```

Durante `npm install` Forgecy abilita controlli Git locali: i commit e i push vengono bloccati se le modifiche contengono formati noti di credenziali. La CI esegue Gitleaks sui commit e `npm run security:scan` sui file tracciati. I controlli mostrano il percorso e il tipo di credenziale rilevato, mai il valore. `.env.local` è escluso da Git.

Apri `http://localhost:3000`. Il server si lega all'interfaccia loopback per impostazione predefinita. Non esporre Forgecy su una rete pubblica: è un'app personale locale, senza autenticazione multiutente.

Il database è creato automaticamente e aggiornato all'avvio. Percorsi predefiniti:

| Sistema | Cartella dati |
| --- | --- |
| macOS | `~/Library/Application Support/Forgecy` |
| Windows | `%LOCALAPPDATA%\Forgecy` |
| Linux | `$XDG_DATA_HOME/forgecy` oppure `~/.local/share/forgecy` |

La cartella contiene `forgecy.sqlite`, i file privati, le impostazioni locali dei backup e, se il portachiavi del sistema non è disponibile, le credenziali protette dai permessi locali. `FORGECY_DATA_DIR` permette di usare una cartella personalizzata. Mantieni il database attivo su un disco locale: non aprirlo da Google Drive, Dropbox, NAS o cartelle di rete.

## Chiavi dei provider

Apri **Impostazioni** nell'app, anche prima di creare il primo cliente, incolla la chiave OpenRouter e premi **Verifica e salva chiave**. Forgecy la prova con OpenRouter prima di conservarla nel portachiavi del sistema operativo; se il portachiavi non è disponibile, la salva nella cartella dati privata con permessi limitati al tuo utente. La chiave non viene inclusa negli archivi di trasferimento. In alternativa, puoi configurarla in `.env.local`, che non va mai aggiunto a Git:

| Variabile | Uso |
| --- | --- |
| `OPENROUTER_API_KEY` | Alternativa alla configurazione dalle Impostazioni; chiave personale per cataloghi e generazione testo e immagini. |
| `OPENROUTER_MODEL` | Modello testo di ripiego se non è impostato un modello nelle preferenze locali. Il valore predefinito è DeepSeek Flash Latest. |
| `OPENROUTER_SITE_URL` | Identificativo facoltativo inviato nei metadati OpenRouter. |
| `APP_ORIGIN` | Origine esatta locale, necessaria con `npm run start`; esempio `http://localhost:3000`. |
| `FORGECY_TAILSCALE_ALLOWED_USER` | Facoltativa; login Tailscale esatto autorizzato a passare da Serve. Non è una chiave e resta in `.env.local`. |
| `FORGECY_TAILSCALE_HOST` | Facoltativa; hostname MagicDNS HTTPS esatto mostrato da `tailscale serve status`, senza schema né porta. |
| `ENABLE_WEBSITE_INGEST` | Facoltativa; l'importazione dei siti è attiva per impostazione predefinita. Imposta `false` per disabilitarla. |

Non usare il prefisso `NEXT_PUBLIC_` per chiavi private.

### Accesso dal telefono via Tailscale

Forgecy può essere raggiunto dal telefono solo tramite Tailscale Serve. Il backend continua ad ascoltare su loopback; il proxy accetta l'hostname tailnet HTTPS esatto configurato in `FORGECY_TAILSCALE_HOST` solo quando Serve inoltra l'identità Tailscale e il login corrisponde a `FORGECY_TAILSCALE_ALLOWED_USER`. Il server non accetta richieste da altri host o utenti del tailnet. Non attivare Funnel, port forwarding o un bind sulla rete locale.

Sul computer server:

1. Accedi a Tailscale con lo stesso account autorizzato anche sul telefono e abilita HTTPS/Serve per il tailnet.
2. Imposta in `.env.local` il login esatto in `FORGECY_TAILSCALE_ALLOWED_USER` e l'hostname `*.ts.net` mostrato da Serve in `FORGECY_TAILSCALE_HOST`.
3. Avvia `npm run dev:tailscale` durante lo sviluppo oppure esegui `npm run build` e `npm run start:tailscale` per la versione di produzione.
4. Controlla `tailscale serve status`: il proxy HTTPS deve puntare a `http://127.0.0.1:7694` ed essere disponibile solo nel tailnet.
5. Dal telefono, con Tailscale connesso, apri il nome HTTPS `*.ts.net` mostrato da Serve.

La regola di accesso Tailscale deve consentire al tuo telefono di raggiungere il nodo server. Il solo fatto che il telefono sia nel tailnet non autorizza altri account: Forgecy verifica anche l'identità inoltrata da Serve.

### Snapshot Instagram

In **Risultati** aggiungi uno username come etichetta locale, poi importa uno snapshot JSON preparato con dati che sei autorizzato a usare. Forgecy non effettua login né richieste automatiche a Instagram. Ogni import crea uno snapshot datato; i successivi si confrontano nello storico e si possono esportare in CSV. Il formato e i limiti sono descritti in INSTAGRAM_SNAPSHOTS.md.

In **Impostazioni → OCR e lettura dei documenti** selezioni il modello OpenRouter per l'OCR. Forgecy non usa OCR locale: il testo già incorporato nei PDF e i formati testuali vengono letti senza OCR, mentre scansioni e immagini vengono inviate a OpenRouter. L'estrazione nativa legge PDF in blocchi di massimo 40 pagine, fino a 500 pagine complessive e 80.000 caratteri; la scheda Fonte segnala pagine o testo eventualmente esclusi. L'OCR divide automaticamente i PDF in blocchi da massimo 40 pagine e 10 MB ciascuno, fino a 200 pagine e al limite totale upload di 64 MiB. Ogni blocco OCR è una richiesta API separata e può generare costi; vengono mostrate le pagine elaborate e l'eventuale troncamento. Se un blocco fallisce dopo gli altri, Forgecy conserva le trascrizioni riuscite; **Riprova OCR** riparte dal primo blocco non completato senza inviare di nuovo quelli già riusciti. Le immagini restano limitate a 10 MB. CSV, tabelle Markdown prodotte dall'OCR e tabelle dei PDF con testo nativo vengono riconciliati localmente con le offerte; il parser supporta anche tabelle senza prezzo e conserva citazioni verificabili. Nei cataloghi PDF testuali con codici articolo nel formato `U` + 8 cifre, come nel campione USAG, Forgecy può usare le coordinate di riga e colonna per collegare misure, codice e prezzo senza inviare il file a un modello. Cataloghi non tabellari possono usare una fase AI separata che invia testo e immagini a OpenRouter. Controlla le tariffe correnti nel tuo account OpenRouter prima di caricare PDF scansionati lunghi. Il parser può restituire fino a 8 immagini.

## Esportare e importare

Forgecy crea un backup all'avvio e poi all'intervallo impostato, mentre il server è in esecuzione. Da **Impostazioni → Backup e trasferimento** scegli la cartella di destinazione, una frequenza da 4 ore a una settimana e quante copie conservare (3, 7, 14 o 30). Il valore predefinito è 8 ore e 7 copie nella cartella privata di Forgecy. La cartella deve essere un percorso assoluto raggiungibile dal computer che esegue il server. Se usi Google Drive per desktop, inserisci una cartella nella sua area sincronizzata: Forgecy scriverà lì archivi `.forgecy.zip` e il client desktop li caricherà senza login Google nell'app. Lo stesso vale per Dropbox e altri client di sincronizzazione. Se la cartella cloud è disconnessa o non scrivibile, la creazione viene segnalata nei log del server e riproverà al ciclo successivo.

La frequenza configurata è rispettata solo mentre Forgecy è in esecuzione; non installa un'attività pianificata di sistema. Quando usi una cartella sincronizzata, le copie automatiche possono essere conservate su cloud. Gli archivi contengono database e documenti del workspace: scegli una destinazione privata e protetta. La rotazione elimina gli archivi più vecchi dalla cartella selezionata e il client cloud può replicare anche queste eliminazioni.

Nella stessa schermata puoi creare una copia subito, scaricare gli archivi elencati, esportare un archivio o importarne uno su un altro computer. L'import sostituisce il workspace corrente dopo i controlli e conserva una copia pre-ripristino in `pre-restore`. Proteggi gli archivi: contengono il database e i documenti del workspace, anche se Forgecy rimuove i token dei social durante l'export. Il database attivo resta sempre nella cartella dati locale: non collocarlo su Drive, Dropbox, NAS o cartelle di rete e non lavorare contemporaneamente sullo stesso workspace da due computer.

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
| Backup non riuscito | Verifica che la cartella selezionata sia collegata, scrivibile e abbia spazio libero. |
| Impossibile usare l'app su un altro dispositivo | Esporta un archivio, trasferiscilo e importalo nell'altra installazione. |
