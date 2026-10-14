# Fonti, acquisizione e dossier

Forgecy può raccogliere fonti web limitate, importare documenti e creare dossier AI basati su evidenze citabili. I dati sono conservati nel database e nella cartella file locale.

## Fonti supportate

- Pagine HTTPS selezionate dal sito del client, con acquisizione limitata e rispetto delle regole di crawling configurate.
- Testo, Markdown, CSV, PDF con livello testuale e DOCX.
- Immagini JPEG/PNG/WebP conservate come originali; non vengono trasformate automaticamente in affermazioni tramite OCR.

Ogni fonte pronta conserva metadati di provenienza e contenuto estratto. Le nuove revisioni aggiornano la revisione della conoscenza del client e invalidano dossier o contenuti diventati obsoleti. La ricerca degli estratti è lessicale e non sostituisce il controllo umano dei fatti.

Il crawler è disattivato in configurazione predefinita. L'app lega il server a loopback; se abiliti acquisizione web, mantieni controlli SSRF e limiti attivi e acquisisci solo siti che sei autorizzato a consultare. I PDF scannerizzati richiedono OCR separato.

## Flusso dossier

1. Aggiungi fonti o offerte verificate al client.
2. L'estrattore convalida tipo, firma e struttura dei documenti prima di salvarli.
3. Forgecy indicizza i testi e recupera estratti pertinenti per il dossier.
4. Ogni evidenza riporta la fonte da cui deriva; il modello può comunque interpretarla male.
5. Rivedi e approva il dossier. Una modifica alle fonti richiede una nuova valutazione.

Per configurare l'app e capire dove sono conservati file e backup, consulta [LOCAL_SETUP.md](LOCAL_SETUP.md).
