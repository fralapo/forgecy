# Forgecy — stato e priorità

Aggiornato il 14 ottobre 2026. Forgecy è un progetto open source per uso personale: funziona in locale, conserva il workspace su SQLite e offre sincronizzazione facoltativa di snapshot su Google Drive. Non è un servizio ospitato né una piattaforma collaborativa.

## Funzioni presenti

- Profili client/brand, fonti e offerte verificate.
- Estrazione sicura di testo, Markdown, CSV, PDF testuali e DOCX; ricerca locale degli estratti e dossier con riferimenti alle fonti.
- Dossier, strategie e proposte AI con stati e approvazione esplicita.
- Coda persistente in SQLite e worker locale, con quote, lease, retry e recupero dopo riavvio.
- Editor statico per Instagram/LinkedIn, calendario editoriale e export.
- Cataloghi OpenRouter correnti per modelli testo e immagini, selezionabili da Impostazioni e salvati nel workspace.
- Export/import verificato e snapshot immutabili Google Drive con scelta manuale in caso di conflitto.
- Integrazione Instagram facoltativa; ogni chiave e autorizzazione resta dell'utente locale.

## Limiti conosciuti

Drive sincronizza solo quando richiesto e trasferisce snapshot completi; non supporta modifica simultanea o merge automatico. Ogni dispositivo conserva le proprie API key. Dossier e immagini inviano i contenuti necessari al modello scelto. I dati d'uso restituiti dal provider sono parziali e non costituiscono un tetto monetario. I PDF scannerizzati non hanno OCR automatico e la ricerca è lessicale.

## Priorità successive

1. Provare la configurazione Google OAuth su un progetto Cloud personale e completare un ciclo export/import fra due computer.
2. Eseguire un flusso end-to-end con una chiave OpenRouter personale, includendo immagine, job e ripartenza dopo arresto.
3. Aggiungere una prova controllata della gestione conflitti con due snapshot divergenti e verificare la copia locale di recupero.
4. Valutare in seguito OCR, ripresa per singolo agente e confronto visuale degli export.

I controlli automatizzati sono in GitHub Actions. L'integrazione effettiva con Google, OpenRouter e Meta richiede credenziali e consenso configurati dall'utente.
