# Forgecy V22 — sicurezza dell'acquisizione documentale

## Modifica

Il primo passaggio su file caricati da un cliente è la validazione di **tipo + firma + struttura**. Solo dopo l'esito positivo il backend salva il file nella cartella privata locale. La stessa validazione viene rieseguita nella libreria di estrazione, compreso il comando di rielaborazione.

I normali PDF testuali, Word DOCX, TXT/MD/CSV UTF-8 e immagini JPEG/PNG/WebP restano formati supportati. Forgecy estrae localmente il testo nativo; se un PDF restituisce meno di 80 caratteri di testo o un'immagine non contiene testo leggibile, invia il file a OpenRouter per l'OCR. Non esiste un motore OCR locale né un fallback locale.

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

- Max **64 MiB per PDF** e **10 MB per gli altri file**. La cartella fonti e gli archivi di trasferimento applicano lo stesso limite ai PDF.
- PDF: firma \`%PDF-\`, terminatore \`%%EOF\`; il testo nativo viene letto in intervalli massimi di 40 pagine, fino a 500 pagine e 80.000 caratteri. Forgecy registra pagine totali, pagine lette e troncamenti. Meno di 80 caratteri nativi fanno scattare l'OCR; il conteggio pagine preflight viene riutilizzato. I PDF scansionati vengono divisi localmente in segmenti massimi di 40 pagine e 10 MB, fino a 200 pagine e 64 MiB totali: sono limiti di elaborazione Forgecy. Per PDF oltre 20 MiB e fino a 40 pagine, Forgecy può prima ridisegnare localmente le pagine come JPEG a risoluzione limitata per contenere i dati inviati; questo passaggio converte soltanto il formato e non estrae né riconosce testo. Se la conversione non riesce o non riduce il file, viene usato l'originale. Ogni segmento è una richiesta Mistral OCR OpenRouter e ha una propria prenotazione della quota AI. Un errore dopo segmenti riusciti conserva il testo ottenuto e registra una fonte parziale; il retry riprende dai segmenti mancanti. Se il parser OpenRouter ha già prodotto \`file_annotations\` prima di un errore downstream, Forgecy salva il testo OCR e non ripete il segmento. Un errore senza annotazioni utili mantiene la fonte in sospeso e riprovabile. Oltre i limiti, la fonte indica le pagine omesse.
- Immagini: firma del formato verificata prima dell'invio a OpenRouter per l'OCR. Per i PDF il parser può restituire al massimo 8 immagini. Per cataloghi PDF testuali, Forgecy estrae immagini native solo dalle pagine in cui numero di prodotti e immagini coincidono; il modello visivo selezionato può ricevere queste immagini e i nomi dei prodotti per confermare gli abbinamenti. È una fase AI distinta dall'OCR, può comportare costi e non collega immagini quando l'associazione resta incerta.
- OCR: viene eseguito esclusivamente tramite API OpenRouter, senza motori OCR locali. Il testo già incorporato nei PDF e i formati testuali vengono letti senza OCR; PDF scannerizzati e immagini sono elaborati fuori dal computer da OpenRouter e dai provider da esso selezionati. Possono applicarsi tariffe per pagina e/o modello secondo il piano corrente. Le chiamate AI registrabili entrano nel registro utilizzo OpenRouter.
- Tabelle: CSV e tabelle Markdown OCR con intestazioni riconosciute per prodotto/modello e prezzo sono interpretati localmente. L'import conserva citazioni letterali di ogni riga e riconcilia al massimo 1.000 voci; i cataloghi non tabellari possono richiedere un passaggio AI distinto.
- Cataloghi PDF testuali: nelle pagine con testo estratto il parser usa anche le coordinate native degli elementi PDF per collegare SKU, specifiche a sinistra e prezzo sulla stessa riga e colonna. Importa solo codici nel formato supportato con una sola corrispondenza prezzo; righe senza specifiche o ambigue vengono scartate. Il limite è 200 righe per documento e ogni campo resta vincolato a citazioni presenti nel testo estratto. Questa lettura locale non esegue OCR né invia il PDF al provider.
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

La pipeline usa limiti di upload e di pagine, ma non implementa antivirus, cancellazione sicura o un processo isolato separato per l'OCR. Un PDF complesso fino a 64 MiB può ancora richiedere risorse locali durante il controllo pagina. Per installazioni esposte a file non fidati ad alto volume servono scansione antivirus, isolamento CPU/memoria, rate limit e retention più stretti.

Per elaborare file non fidati ad alto volume servono un threat model e test in un ambiente isolato. Queste difese sono integrate su `main` dalla release V24 (#100); non aggiungono migrazioni SQL o variabili d'ambiente. Per l'installazione personale corrente seguire [LOCAL_SETUP.md](LOCAL_SETUP.md) e applicare le migrazioni 0001–0018.

Riferimenti:
- ZIP/OOXML: https://www.loc.gov/preservation/digital/formats/fdd/fdd000354
- Node.js zlib: https://nodejs.org/api/zlib.html
- OWASP File Upload: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
