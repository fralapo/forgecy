# Forgecy — stato e priorità

Aggiornato il 14 ottobre 2026. Forgecy è un progetto open source per uso personale: funziona in locale, conserva il workspace su SQLite e offre sincronizzazione facoltativa di snapshot su Google Drive. Non è un servizio ospitato né una piattaforma collaborativa.

## Funzioni presenti

- Profili client/brand, fonti e offerte verificate.
- Acquisizione sicura di siti e documenti: estrae in locale HTML, Markdown, CSV, PDF testuali e DOCX; usa OCR OpenRouter per PDF scannerizzati e immagini senza testo estraibile.
- Memoria locale in SQLite con passaggi citabili e recupero ibrido: FTS5 sempre disponibile e ricerca semantica MiniLM locale attiva di default, indicizzata in background e disattivabile.
- Riconciliazione dei cataloghi con le offerte esistenti, protezione dei campi modificati manualmente e associazione delle immagini prodotto quando l'evidenza è chiara.
- Dossier, strategie e proposte AI con stati e approvazione esplicita.
- Coda persistente in SQLite e worker locale, con quote, lease, retry e recupero dopo riavvio.
- Editor statico per Instagram/LinkedIn, calendario editoriale e export.
- Importazione manuale di snapshot Instagram e conteggio follower dall'archivio JSON dell'account proprietario; i nomi restano nel browser. Nessuno scraping o accesso automatico alla piattaforma.
- Cataloghi OpenRouter correnti per modelli testo e immagini, selezionabili da Impostazioni e salvati nel workspace.
- Export/import verificato, backup locali automatici a rotazione e snapshot immutabili Google Drive con scelta manuale in caso di conflitto.

## Limiti conosciuti

Drive sincronizza solo quando richiesto e trasferisce snapshot completi, inclusi i vettori semantici; non supporta modifica simultanea o merge automatico. I backup locali vengono creati all'avvio e poi ogni 8 ore mentre Forgecy è in uso; ne restano gli ultimi 7 sullo stesso computer. Non proteggono da guasto o perdita del disco: per una copia esterna usa esportazione o Drive. Ogni dispositivo conserva le proprie API key. I documenti escono dal dispositivo quando si seleziona OpenRouter; l'estrazione AI dei cataloghi è una fase separata. I dati d'uso restituiti sono parziali e non costituiscono un tetto monetario. Il modello semantico si scarica nella cache locale di ciascun computer; FTS5 resta sempre disponibile come fallback.

## Priorità successive

1. **Implementazione pronta; verifica reale in attesa della configurazione Google personale.** Il Client ID può essere salvato dalle impostazioni nella cartella dati privata del computer (oppure letto da `.env.local`); non entra nel workspace o nei backup. Il flusso desktop PKCE e il rifiuto dello state OAuth errato hanno test isolati. Per completare il ciclo servono ancora il progetto OAuth personale, il consenso sul computer host e la prova di sincronizzazione dal secondo computer.
2. **Completata su dati sintetici.** Prova live isolata con la chiave OpenRouter locale: PDF scannerizzato di una pagina, OCR Mistral, estrazione e riconciliazione AI (1 prodotto aggiornato, 1 aggiunto, 0 invalidi; costo riportato 0,002825 USD). Il test SQLite chiude e riapre il database e recupera il job scaduto con lease rinnovata. Nessun dato cliente è stato usato e la chiave non è stata stampata o scritta nel workspace.
3. **Completata in test isolato.** Due archivi completi con contenuti diversi e lo stesso snapshot antenato sono rilevati come teste divergenti; la copia locale è salvata prima del ripristino del ramo remoto, resta valida dopo il ripristino e conserva le modifiche specifiche del ramo locale. La sincronizzazione Google reale resta da provare con OAuth.
4. **Baseline pubblica iniziale completata; ampliamento e ripetibilità ancora aperti.** Due pagine del catalogo pubblico BioMatrix 2024–25: OCR corretto su 8/8 varianti di tabella, 1 prodotto aggiornato, 1 aggiunto, 0 invalidi e 2/2 abbinamenti foto verificati a vista; costo riportato 0,011219 USD. Sul listino pubblico Bosch 2025, pagina 2, l'OCR ha trovato tutti e 3 gli indicatori attesi. Una prova completa ha impiegato 51,967 s e 2 richieste API (OCR + estrazione), costo riportato 0,010213 USD: 7 prodotti aggiunti, una riga scartata. Le prove successive restano variabili: il modello visivo a volte termina senza prodotti verificabili e il fallback testo ha restituito JSON vuoto/invalido o ha superato il timeout; l'ultima prova ha impiegato 84,119 s, registrato 3 richieste e 0,014892 USD, trovato 3/3 indicatori OCR ma nessun prodotto importabile. Una chiamata sintetica a JSON Schema con ragionamento disattivato è riuscita in 3,3 s con un prodotto: il limite residuo è quindi l'estrazione/evidenza sul documento reale, non la sintassi di base dell'endpoint. Il codice ora disattiva il ragionamento per l'estrazione catalogo, limita i tempi, riprova su testo quando le immagini non danno evidenze e tronca la riconciliazione a 40 prodotti; i log registrano solo forma/status e mai contenuto o credenziali. L'OCR locale è stato rimosso: scansioni e immagini passano tramite API. Servono importazioni Bosch ripetibili, capire i passaggi che restituiscono zero prove, altri documenti italiani e un corpus annotato rappresentativo per misurare accuratezza, tempi e costi API.

I controlli automatizzati sono in GitHub Actions. Google Drive e OpenRouter richiedono credenziali configurate dall'utente. Instagram accetta snapshot manuali e conteggi follower dall'archivio JSON dell'account proprietario; non estrae metriche dei post dall'archivio e non raccoglie dati da altri profili. Dettagli e limiti sono in INSTAGRAM_SNAPSHOTS.md.
