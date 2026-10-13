# Forgecy V22 — sicurezza dell'acquisizione documentale

## Modifica

Il primo passaggio su file caricati da un cliente è ora la validazione di **tipo + firma + struttura**. Solo dopo l'esito positivo il backend salva il file nel bucket privato Supabase. La stessa validazione viene rieseguita nella libreria di estrazione, compreso il comando di rielaborazione.

I normali PDF testuali, Word DOCX, TXT/MD/CSV UTF-8 e immagini JPEG/PNG/WebP restano formati supportati. Le immagini restano **pending**: nessuna inferenza OCR è stata introdotta.

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
- PDF: firma \`%PDF-\`, terminatore \`%%EOF\` e parser testuale limitato alle prime 40 pagine. I PDF scannerizzati non vengono interpretati automaticamente.
- TXT/MD/CSV: codifica UTF-8 valida, senza byte NUL.
- PNG/JPEG/WebP: verifica delle firme standard, senza dichiarare che il resto della struttura dell'immagine sia completamente valido.

## Copertura test

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

Questa PR **non implementa antivirus, sandbox CPU/memoria, cancellazione sicura, isolamento dei parser, OCR o gestione code separate per file**. Un PDF particolarmente complesso può ancora richiedere molte risorse. Il parsing dei file arbitrari andrebbe spostato in worker con limiti di tempo, memoria e permessi; è anche necessario monitorare dipendenze, prevedere quarantine/scansioni antivirus, rate limit utenti e retention.

Non mettere in produzione elaborazione di file non fidati ad alto volume senza un threat model e test end-to-end su staging. Queste modifiche sono **incrementali sul branch V21**: non applicano migrazioni SQL e non richiedono nuove variabili d'ambiente. Per distribuire correttamente seguire la catena di PR #91 → #93 → #94 → #96 → PR V22.

Riferimenti:
- ZIP/OOXML: https://www.loc.gov/preservation/digital/formats/fdd/fdd000354
- Node.js zlib: https://nodejs.org/api/zlib.html
- OWASP File Upload: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
