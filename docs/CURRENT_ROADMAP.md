# Forgecy — stato e priorità

Aggiornato il 14 ottobre 2026. Forgecy è un progetto open source per uso personale: funziona in locale, conserva il workspace su SQLite e offre sincronizzazione facoltativa di snapshot su Google Drive. Non è un servizio ospitato né una piattaforma collaborativa.

## Funzioni presenti

- Profili client/brand, fonti e offerte verificate.
- Acquisizione sicura di siti e documenti: estrae prima in locale HTML, Markdown, CSV, PDF testuali e DOCX; per immagini e PDF scannerizzati supporta OCR PaddleOCR-VL locale, OpenRouter e scelta automatica basata sull'hardware.
- Memoria locale in SQLite con passaggi citabili, FTS5 sempre disponibile e ricerca semantica MiniLM opt-in calcolata sul dispositivo.
- Riconciliazione dei cataloghi con le offerte esistenti, protezione dei campi modificati manualmente e associazione delle immagini prodotto quando l'evidenza è chiara.
- Dossier, strategie e proposte AI con stati e approvazione esplicita.
- Coda persistente in SQLite e worker locale, con quote, lease, retry e recupero dopo riavvio.
- Editor statico per Instagram/LinkedIn, calendario editoriale e export.
- Cataloghi OpenRouter correnti per modelli testo e immagini, selezionabili da Impostazioni e salvati nel workspace.
- Export/import verificato e snapshot immutabili Google Drive con scelta manuale in caso di conflitto.
- Integrazione Instagram facoltativa; ogni chiave e autorizzazione resta dell'utente locale.

## Limiti conosciuti

Drive sincronizza solo quando richiesto e trasferisce snapshot completi; non supporta modifica simultanea o merge automatico. Ogni dispositivo conserva le proprie API key. I documenti escono dal dispositivo quando si seleziona OpenRouter; l'estrazione AI dei cataloghi è una fase separata. I dati d'uso restituiti sono parziali e non costituiscono un tetto monetario. L'indice semantico è facoltativo e locale; FTS5 resta il fallback.

## Priorità successive

1. Provare la configurazione Google OAuth su un progetto Cloud personale e completare un ciclo export/import fra due computer.
2. Eseguire un flusso end-to-end con una chiave OpenRouter personale, includendo OCR di un PDF scannerizzato, riconciliazione delle offerte e ripartenza di un job dopo arresto.
3. Aggiungere una prova controllata della gestione conflitti con due snapshot divergenti e verificare la copia locale di recupero.
4. Ampliare l'evaluation con documenti rappresentativi reali: accuratezza OCR, copertura delle tabelle e qualità del collegamento delle foto prodotto.

I controlli automatizzati sono in GitHub Actions. L'integrazione effettiva con Google, OpenRouter e Meta richiede credenziali e consenso configurati dall'utente.
