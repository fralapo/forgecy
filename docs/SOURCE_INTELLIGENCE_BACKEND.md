# Fonti, acquisizione e dossier

Forgecy può raccogliere fonti web limitate, importare documenti e creare dossier AI basati su evidenze citabili. I dati sono conservati nel database e nella cartella file locale.

## Fonti supportate

- Pagine HTTPS scoperte da sitemap e link interni, fino a 100 per scansione. I prodotti estratti dai cataloghi e dai dati strutturati vengono aggiunti al catalogo già confermati, con descrizione, prezzo quando disponibile e collegamento alla foto locale quando il sito la fornisce. L'utente può modificarli o eliminarli; le campagne e i contenuti storici vengono conservati scollegando l'offerta eliminata.
- Testo, Markdown, CSV, PDF con livello testuale e DOCX.
- Loghi e immagini JPEG/PNG/WebP/GIF/AVIF, oltre a PDF, DOCX, Markdown, testo e CSV pubblicati sullo stesso host. Vengono conservati nell'archivio privato locale; per scansione il limite è 48 immagini e 12 documenti. Le immagini possono essere lette con il parser OCR locale oppure OpenRouter, secondo la preferenza in Impostazioni.

Ogni fonte pronta conserva metadati di provenienza e contenuto estratto. Le nuove revisioni aggiornano la revisione della conoscenza del client e invalidano dossier o contenuti diventati obsoleti. La ricerca degli estratti è lessicale e non sostituisce il controllo umano dei fatti.

## Importazione e aggiornamento dei cataloghi

Quando carichi un CSV con colonne prodotto, descrizione e prezzo, Forgecy lo legge in locale e confronta le righe con le offerte già presenti. Un PDF o DOCX riconosciuto come catalogo usa il modello di testo OpenRouter configurato per estrarre prodotti strutturati. Per un PDF scannerizzato puoi scegliere PaddleOCR-VL locale, OpenRouter o la modalità automatica basata sull'hardware; le immagini caricate seguono la stessa scelta. L'aggiornamento locale usa versioni isolate e un test prima di attivare il nuovo parser. Se OCR non è disponibile o fallisce, la fonte resta pending e può essere riprovata. La riconciliazione richiede citazioni testuali esatte per i campi e associa un'immagine al prodotto solo quando il modello individua una corrispondenza supportata. L'estrazione AI strutturata resta una fase separata da OCR e può inviare testo e immagini a OpenRouter.

Forgecy richiede riscontri testuali esatti nel documento per nome, descrizione e prezzo prima di applicare un dato. Le corrispondenze probabili aggiornano la scheda esistente; i prodotti nuovi vengono aggiunti come verificati, con il documento collegato come fonte. Una modifica manuale a nome, descrizione, prezzo o altri campi della scheda la protegge dai successivi aggiornamenti automatici. Le foto già collegate restano associate quando un documento arricchisce la scheda. Dalla scansione ripetuta della fonte puoi rieseguire lo stesso confronto dopo aver sostituito il file.

Il crawler è attivo in configurazione predefinita e si può disabilitare con `ENABLE_WEBSITE_INGEST=false`. In creazione cliente puoi scegliere sito, documenti, entrambi o rimandare. Se l'importazione trova fonti, Forgecy accoda la preparazione del dossier. L'app lega il server a loopback; il crawler accetta solo HTTPS pubblico, rispetta `robots.txt`, resta sullo stesso host e non segue redirect. Le immagini di prodotto vengono archiviate localmente e mostrate nella scheda dell'offerta; le scansioni possono usare OCR locale o remoto entro i limiti descritti in [DOCUMENT_INGEST_SECURITY.md](DOCUMENT_INGEST_SECURITY.md).

## Flusso dossier

1. Aggiungi fonti o offerte verificate al client.
2. L'estrattore convalida tipo, firma e struttura dei documenti prima di salvarli; usa OCR remoto soltanto quando l'estrazione locale non produce testo e l'utente ha configurato OpenRouter.
3. Forgecy indicizza i testi e recupera estratti pertinenti per il dossier.
4. Ogni evidenza riporta la fonte da cui deriva; il modello può comunque interpretarla male.
5. Rivedi e approva il dossier. Una modifica alle fonti richiede una nuova valutazione.

Per configurare l'app e capire dove sono conservati file e backup, consulta [LOCAL_SETUP.md](LOCAL_SETUP.md).
