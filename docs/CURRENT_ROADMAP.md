# Forgecy — stato e priorità

Aggiornato il 14 ottobre 2026. Forgecy è un progetto open source per uso personale: funziona in locale, conserva il workspace su SQLite e offre sincronizzazione facoltativa di snapshot su Google Drive. Non è un servizio ospitato né una piattaforma collaborativa.

## Funzioni presenti

- Profili client/brand, fonti e offerte verificate.
- Acquisizione sicura di siti e documenti: estrae prima in locale HTML, Markdown, CSV, PDF testuali e DOCX; per immagini e PDF scannerizzati supporta OCR PaddleOCR-VL locale, OpenRouter e scelta automatica basata sull'hardware.
- Memoria locale in SQLite con passaggi citabili e recupero ibrido: FTS5 sempre disponibile e ricerca semantica MiniLM locale attiva di default, indicizzata in background e disattivabile.
- Riconciliazione dei cataloghi con le offerte esistenti, protezione dei campi modificati manualmente e associazione delle immagini prodotto quando l'evidenza è chiara.
- Dossier, strategie e proposte AI con stati e approvazione esplicita.
- Coda persistente in SQLite e worker locale, con quote, lease, retry e recupero dopo riavvio.
- Editor statico per Instagram/LinkedIn, calendario editoriale e export.
- Importazione manuale di snapshot Instagram e conteggio follower dall'archivio JSON dell'account proprietario; i nomi restano nel browser. Nessuno scraping o accesso automatico alla piattaforma.
- Cataloghi OpenRouter correnti per modelli testo e immagini, selezionabili da Impostazioni e salvati nel workspace.
- Export/import verificato, backup locali automatici a rotazione e snapshot immutabili Google Drive con scelta manuale in caso di conflitto.
- Importazione locale di snapshot JSON Instagram, confronto storico e export CSV; nessun accesso automatico alla piattaforma.

## Limiti conosciuti

Drive sincronizza solo quando richiesto e trasferisce snapshot completi, inclusi i vettori semantici; non supporta modifica simultanea o merge automatico. I backup locali vengono creati all'avvio e poi ogni 8 ore mentre Forgecy è in uso; ne restano gli ultimi 7 sullo stesso computer. Non proteggono da guasto o perdita del disco: per una copia esterna usa esportazione o Drive. Ogni dispositivo conserva le proprie API key. I documenti escono dal dispositivo quando si seleziona OpenRouter; l'estrazione AI dei cataloghi è una fase separata. I dati d'uso restituiti sono parziali e non costituiscono un tetto monetario. Il modello semantico si scarica nella cache locale di ciascun computer; FTS5 resta sempre disponibile come fallback.

## Priorità successive

1. Provare la configurazione Google OAuth su un progetto Cloud personale e completare un ciclo export/import fra due computer.
2. **Completata su dati sintetici.** Prova live isolata con la chiave OpenRouter locale: PDF scannerizzato di una pagina, OCR Mistral, estrazione e riconciliazione AI (1 prodotto aggiornato, 1 aggiunto, 0 invalidi; costo riportato 0,002825 USD). Il test SQLite chiude e riapre il database e recupera il job scaduto con lease rinnovata. Nessun dato cliente è stato usato e la chiave non è stata stampata o scritta nel workspace.
3. Aggiungere una prova controllata della gestione conflitti con due snapshot divergenti e verificare la copia locale di recupero.
4. Ampliare l'evaluation con documenti rappresentativi reali: accuratezza OCR, copertura delle tabelle e qualità del collegamento delle foto prodotto.

I controlli automatizzati sono in GitHub Actions. Google Drive e OpenRouter richiedono credenziali configurate dall'utente. Instagram accetta snapshot manuali e conteggi follower dall'archivio JSON dell'account proprietario; non estrae metriche dei post dall'archivio e non raccoglie dati da altri profili. Dettagli e limiti sono in INSTAGRAM_SNAPSHOTS.md.
