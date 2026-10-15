# Ripartire su un nuovo computer

Questa pagina riassume lo stato del repository e il percorso consigliato per riprendere Forgecy su un altro PC. Il repository contiene il codice e la documentazione; il workspace SQLite, i file dei clienti e le chiavi API rimangono sul computer e non vengono caricati su GitHub.

## Avvio

Clona il repository GitHub, installa Node.js 22.18 o successivo e avvia:

```sh
npm install
cp .env.example .env.local
npm run dev
```

Apri `http://localhost:3000`, poi vai in Impostazioni per inserire la tua chiave OpenRouter e scegliere i modelli. `.env.local` è escluso da Git. I modelli testo e immagini vengono caricati dal catalogo OpenRouter aggiornato; i valori iniziali sono DeepSeek Flash Latest per il testo e GPT Image per le immagini.

## Portare il workspace sul nuovo PC

GitHub non contiene il database né i documenti locali. Sul vecchio computer, apri **Impostazioni → Backup e trasferimento**, usa **Esporta archivio** e trasferisci il file `.forgecy.zip` in modo sicuro; sul nuovo computer usa **Importa archivio**. I backup automatici possono essere salvati in una cartella assoluta scelta dall'utente. Se il client Drive per desktop sincronizza quella cartella, le copie vengono caricate automaticamente senza login Google nell'app.

Proteggi gli archivi: contengono database e documenti dei clienti. Le chiavi API non vengono esportate e vanno configurate di nuovo sul nuovo computer.

## Cosa contiene questa versione

- App single-user local-first, con SQLite locale, chiavi personali e nessun backend Supabase.
- Importazione di siti e fonti, acquisizione di asset, immagini e cataloghi, aggiornamento o rimozione delle fonti e riconciliazione dei prodotti con i documenti.
- Memoria basata su fonti e passaggi, con ricerca ibrida FTS5 + MiniLM locale attiva per default e indicizzata in background; i vettori sono inclusi negli archivi e il modello resta nella cache per dispositivo. Vedere [architettura della conoscenza](KNOWLEDGE_ARCHITECTURE.md).
- Impostazioni OpenRouter per cataloghi aggiornati, modelli testo/immagini e chiavi locali.
- Nessun motore OCR locale: i PDF scannerizzati e le immagini vengono elaborati esclusivamente via API OpenRouter. La lettura nativa dei PDF è a intervalli (40 pagine), fino a 500 pagine e 80.000 caratteri; I PDF misti mantengono il testo nativo e inviano solo le pagine scansionate; l'OCR API segmenta PDF fino a 200 pagine e 64 MiB in richieste da massimo 10 pagine/10 MB. Ogni segmento OCR ha quota e costo separati; un retry riprende dai blocchi mancanti senza ripetere quelli riusciti. L'estrazione strutturata del catalogo resta un passaggio AI separato. Consulta [configurazione locale](LOCAL_SETUP.md) e [stato della conoscenza](KNOWLEDGE_ARCHITECTURE.md).
- Trasferimento del workspace tramite archivi `.forgecy.zip` esportabili e importabili.
- Backup automatici in una cartella scelta dall'utente, con intervallo e rotazione configurabili; la schermata mostra l'ultimo successo e segnala gli errori. Un client desktop come Google Drive può sincronizzare gli archivi.

## Verifica e limiti noti

Per controllare una modifica:

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

I test locali non convalidano le credenziali OpenRouter dell'installazione. Non inserire chiavi reali in issue, documenti o file versionati; su ciascun computer configurale nell'app o nel proprio `.env.local`.

Per i dettagli aggiornati su requisiti, backup e troubleshooting, iniziare da [LOCAL_SETUP.md](LOCAL_SETUP.md). La [roadmap](CURRENT_ROADMAP.md) e lo [stato implementazione](IMPLEMENTATION_STATUS.md) descrivono il prodotto e i controlli automatici.
