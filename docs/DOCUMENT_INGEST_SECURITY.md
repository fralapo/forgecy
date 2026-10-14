# Forgecy V22 — sicurezza dell'acquisizione documentale

## Modifica

Il primo passaggio su file caricati da un cliente è la validazione di **tipo + firma + struttura**. Solo dopo l'esito positivo il backend salva il file nella cartella privata locale. La stessa validazione viene rieseguita nella libreria di estrazione, compreso il comando di rielaborazione.

I normali PDF testuali, Word DOCX, TXT/MD/CSV UTF-8 e immagini JPEG/PNG/WebP restano formati supportati. Forgecy estrae localmente il testo nativo; solo quando un PDF scannerizzato o un'immagine non ha testo leggibile invia il file a OpenRouter per l'OCR. Non esiste un motore OCR locale né un fallback locale.

## Controlli DOCX

I DOCX sono ZIP OOXML, quindi la sola dimensione upload non limita il lavoro di decompressione. La funzione \`inspectDocxArchive\` convalida:

- Fine directory ZIP e central directory (voci, offsets, dimensioni e file locali).
- ZIP monodisco, non cifrati, non ZIP64, compressione STORE/DEFLATE.
- Massimo 400 elementi, massimo 24 MiB per elemento e 64 MiB espansi in totale.
- Rapporto di compressione massimo 250:1 per elemento; verifica **dei byte realmente decompressi**, non solo del valore dichiarato, con \`inflateRawSync\` e \`maxOutputLength\`.
- Niente percorsi \`../\`, assoluti, ripetuti, symlink, macro o cartelle OOXML \`word/embeddings\` e \`word/activeX\`.
- Presenza dei componenti Word necessari, inclusi \`[Content_Types].xml\`, \`_rels/.rels\` e \`word/document.xml\`.

Non effettua estrazione dei file sul disco, non esegue macro o link. Non considera affidabili i metadati ZIP esterni. I limiti sono deliberatamente conservativi: documenti grandi o DOCX con oggetti incorporati potrebbero essere rifiutati, con messaggio esplicito.

## Altri formati

- Max **10 MB** per file (limite esistente, rafforzato nel validatore centrale).
- PDF: firma \`%PDF-\`, terminatore \`%%EOF\` e parser testuale limitato alle prime 40 pagine. Se non estrae testo, viene invocato il file-parser OpenRouter con Mistral OCR; i file oltre le 40 pagine restano archiviati e possono essere divisi e ricaricati.
- Immagini: firma del formato verificata prima dell'invio a OpenRouter per l'OCR. Per i PDF il parser può restituire al massimo 8 immagini; l'eventuale passaggio di immagini al modello AI per estrarre i prodotti è distinto dall'OCR. Forgecy collega una foto a un prodotto solo quando l'associazione è chiara.
- OCR: viene eseguito esclusivamente tramite API OpenRouter, senza motori OCR locali. Il testo già incorporato nei PDF e i formati testuali vengono letti senza OCR; PDF scannerizzati e immagini sono elaborati fuori dal computer da OpenRouter e dai provider da esso selezionati. Possono applicarsi tariffe per pagina e/o modello secondo il piano corrente. Le chiamate AI registrabili entrano nel registro utilizzo OpenRouter.
- Ogni estrazione AI resta evidenza non attendibile. L'importazione prodotti conserva solo campi con citazioni letterali verificate sul testo estratto e non sovrascrive campi bloccati da modifiche manuali.
- TXT/MD/CSV: codifica UTF-8 valida, senza byte NUL.
- PNG/JPEG/WebP: verifica delle firme standard, senza dichiarare che il resto della struttura dell'immagine sia completamente valido.

## Copertura test

### OCR tramite API

- L'OCR è eseguito solo tramite OpenRouter per PDF scannerizzati e immagini. Non è previsto un motore OCR locale. Richiede una chiave configurata e il modello selezionato; se la chiamata fallisce, la fonte resta in sospeso e può essere riprovata.
- L'upload a OpenRouter comporta elaborazione esterna e può comportare costi del provider. L'estrazione AI strutturata di cataloghi è una fase separata e può trasmettere testo e immagini al modello configurato.

\`tests/unit/document-safety.test.ts\` produce un ZIP DOCX reale e verifica estrazione Mammoth. Testa anche:
- archivio cifrato;
- path traversal;
- voci duplicate;
- macro / ActiveX / contenuto embedded;
- DOCX con rapporto di decompressione anomalo;
- dimensioni ZIP dichiarate false;
- mismatch MIME / estensione, PDF invalido, PNG fittizio e testo UTF-8 invalido.

\`tests/unit/skills.test.ts\` è stato aggiornato con una firma PNG completa nella fixture.

## Limitazioni e requisiti per la produzione

La pipeline usa limiti di upload e di pagine, ma non implementa antivirus, cancellazione sicura o un processo isolato separato per l'OCR. Un PDF complesso può ancora richiedere risorse locali durante il controllo pagina. Per installazioni esposte a file non fidati ad alto volume servono scansione antivirus, isolamento CPU/memoria, rate limit e retention più stretti.

Per elaborare file non fidati ad alto volume servono un threat model e test in un ambiente isolato. Queste difese sono integrate su `main` dalla release V24 (#100); non aggiungono migrazioni SQL o variabili d'ambiente. Per l'installazione personale corrente seguire [LOCAL_SETUP.md](LOCAL_SETUP.md) e applicare le migrazioni 0001–0018.

Riferimenti:
- ZIP/OOXML: https://www.loc.gov/preservation/digital/formats/fdd/fdd000354
- Node.js zlib: https://nodejs.org/api/zlib.html
- OWASP File Upload: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
