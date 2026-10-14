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

GitHub non contiene il database né i documenti locali. Sul vecchio computer, apri **Impostazioni → Google Drive**, collega il tuo Drive e premi **Sincronizza adesso**. Sul nuovo computer configura `GOOGLE_DRIVE_CLIENT_ID`, collega lo stesso account e sincronizza il workspace. La sincronizzazione trasferisce snapshot completi e versionati: va usata un computer alla volta, sincronizzando prima di cambiare dispositivo. Se Forgecy rileva copie divergenti, conserva i rami e chiede quale aprire; non fonde automaticamente i record.

In alternativa, sul vecchio computer usa **Esporta archivio** e trasferisci il file `.forgecy.zip` in modo sicuro; sul nuovo computer usa **Importa archivio**. Proteggi l'archivio: contiene database e documenti dei clienti. Le chiavi API e i token non fanno parte degli snapshot, quindi vanno configurati di nuovo sul nuovo computer.

## Cosa contiene questa versione

- App single-user local-first, con SQLite locale, chiavi personali e nessun backend Supabase.
- Importazione di siti e fonti, acquisizione di asset, immagini e cataloghi, aggiornamento o rimozione delle fonti e riconciliazione dei prodotti con i documenti.
- Memoria basata su fonti e passaggi, con ricerca ibrida FTS5 + MiniLM locale attiva per default e indicizzata in background; i vettori sono inclusi nei backup/Drive e il modello resta nella cache per dispositivo. Vedere [architettura della conoscenza](KNOWLEDGE_ARCHITECTURE.md).
- Impostazioni OpenRouter per cataloghi aggiornati, modelli testo/immagini e chiavi locali.
- Nessun motore OCR locale: i PDF scannerizzati e le immagini vengono elaborati esclusivamente via API OpenRouter. La lettura del testo nativo nei PDF e dei formati testuali non richiede OCR. Il file viene elaborato una volta durante il caricamento; l'estrazione strutturata del catalogo è un passaggio AI separato. Consulta [configurazione locale](LOCAL_SETUP.md) e [stato della conoscenza](KNOWLEDGE_ARCHITECTURE.md).
- Google Drive opzionale per trasferire snapshot tra computer, senza sincronizzazione simultanea o merge automatico.
- Backup locali automatici ogni 8 ore, con rotazione a 7 copie; per protezione da perdita del dispositivo resta necessario esportare o sincronizzare su Drive.

## Verifica e limiti noti

Per controllare una modifica:

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

I test locali non convalidano le credenziali OpenRouter o il consenso OAuth Google dell'installazione. Non inserire chiavi reali in issue, documenti o file versionati; su ciascun computer configurale nell'app o nel proprio `.env.local`.

Per i dettagli aggiornati su requisiti, backup, Drive e troubleshooting, iniziare da [LOCAL_SETUP.md](LOCAL_SETUP.md). La [roadmap](CURRENT_ROADMAP.md) e lo [stato implementazione](IMPLEMENTATION_STATUS.md) descrivono il prodotto e i controlli automatici.
