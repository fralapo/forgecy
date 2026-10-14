# Memoria locale e recupero delle conoscenze per gli agenti

**Decisione:** Forgecy adotta una memoria locale centrata sulle evidenze e un recupero ibrido progressivo. SQLite resta la fonte di verità; i dati strutturati e approvati restano strutturati; la ricerca sui documenti lavora sui singoli passaggi. FTS5 è sempre disponibile. Gli embeddings semantici sono facoltativi, calcolati sul computer e combinati con il ranking lessicale. Non serve introdurre un database RAG ospitato o inviare automaticamente i documenti a un altro fornitore.

Per l'OCR la scelta è **ibrida**: estrazione nativa sempre locale; per scansioni e immagini l'utente sceglie OpenRouter, PaddleOCR-VL locale o modalità automatica. Il controllo hardware considera sistema, architettura, RAM, spazio libero e presenza di `uv`; consiglia l'API sotto i requisiti supportati e passa al parser locale in automatico solo se è installato e la macchina è idonea. Il locale usa l'intera pipeline documentale PaddleOCR-VL (layout, tabelle e immagini), non un singolo modello VLM scollegato. Il setup usa un virtualenv privato con Python gestito da `uv` e dipendenze versionate, senza alterare il Python globale.

Il controllo aggiornamenti legge l'ultima release stabile di PaddleOCR, ignora tag preliminari e crea una nuova installazione separata. Scarica runtime e modelli in staging, esegue un'inferenza di prova su un'immagine sintetica e cambia il puntatore attivo solo se il test passa. Se il test o il download falliscono, mantiene la versione precedente. Dopo l'attivazione elimina i vecchi pacchetti, modelli e cache per release quando non sono in uso; conserva il Python gestito condiviso. L'aggiornamento automatico è attivo per impostazione predefinita e controlla ogni mezz'ora mentre Forgecy è aperto. Richiede `uv`, connessione e spazio libero; l'app mostra prerequisiti e stato. Il benchmark 96,33% dichiarato da PaddleOCR per OmniDocBench v1.6 è un risultato del progetto, non una garanzia di accuratezza sui documenti Forgecy.

## Perché questa scelta

Forgecy è single-user e local-first: SQLite e gli asset sul disco sono il workspace autorevole; Drive trasferisce snapshot manuali tra computer. Spostare la memoria in un servizio vettoriale cloud aggiungerebbe costi, credenziali e un secondo posto in cui conservare contenuti dei clienti, senza risolvere da solo la qualità delle risposte.

RAG è il pattern giusto per le domande che richiedono di trovare passaggi in siti, PDF, note e documenti. Non deve però sostituire le tabelle già affidabili per offerte verificate, identità del brand, revisioni e dossier approvati. Il dossier è una sintesi controllabile da una persona; le fonti con provenienza sono le prove; il recupero porta all’agente soltanto i passaggi pertinenti al compito.

## Stato attuale verificato nel codice

- Le fonti sono salvate in SQLite e suddivise in passaggi da circa 1.500 caratteri, mantenendo paragrafi e titoli quando possibile, con collegamento alla fonte, numero del passaggio e sezione.
- SQLite FTS5 fornisce ricerca full-text e ranking BM25; la documentazione ufficiale supporta ranking per colonne, snippet e tokenizer Unicode. [SQLite FTS5](https://www.sqlite.org/fts5.html)
- Chat, dossier e fasi di missione interrogano la memoria con domande mirate. Una corrispondenza nel mezzo di una fonte lunga viene restituita come passaggio, non sostituita dall’inizio del documento.
- La ricerca lessicale indicizza e classifica ciascun passaggio. La migrazione locale ricostruisce l’indice esistente e aggiunge i metadati di sezione.
- L’acquisizione HTML conserva titoli, paragrafi, liste e righe di tabella. L’importazione dei file mantiene i metadati della fonte; ogni passaggio resta verificabile sul testo originale.
- PDF e documenti vengono letti prima in locale. Per scansioni e immagini la modalità selezionata sceglie PaddleOCR-VL locale oppure il percorso API OpenRouter. Il parser locale esegue layout, testo, tabelle e immagini; le immagini autonome e gli input per l'API usano il modello visivo selezionato dal catalogo OpenRouter corrente. Il motore Mistral costa 2 USD per 1.000 pagine secondo [OpenRouter](https://openrouter.ai/blog/announcements/universal-pdf-support/); la modalità API richiede una chiave e manda il documento fuori dal computer. L'OCR locale non usa la chiave né registra consumo OpenRouter.
- In Impostazioni l’utente può abilitare la ricerca semantica locale e costruire l’indice in lotti. Forgecy scarica al primo uso il modello multilingue MiniLM quantizzato da Hugging Face (circa 130 MB nel test locale); il runtime e gli embeddings restano nella cartella dati locale. I contenuti non vengono spediti al servizio di embeddings. Se il modello non è disponibile, Forgecy continua con FTS5.
- La ricerca semantica viene fusa con quella lessicale tramite Reciprocal Rank Fusion, senza confrontare direttamente i loro punteggi. Si attiva esplicitamente e non cambia i risultati finché l’indice locale non è pronto.
- Il dossier controlla gli ID delle fonti e richiede che le citazioni dichiarate come verificate corrispondano a testo effettivo.
- Chat recupera passaggi per la domanda e il dossier interroga più temi. Le fasi di missione ora recuperano prove in base al brief, all’analisi strategica, all’offerta e alle bozze da controllare; il Brand Guard riceve i passaggi originali pertinenti invece di un dump delle prime fonti.

## Struttura raccomandata

### 1. Memoria strutturata e autorevole

Continuare a usare i record esistenti per cliente, profilo e voce del brand, asset del logo e palette, offerte, dossier, strategia approvata, segnali social e stato delle fonti. A ogni valore importante associare stato (bozza, verificato, approvato), provenienza, data e revisione della conoscenza. Prezzi, disponibilità, ingredienti e benefici verificati vanno letti dai record strutturati, non ricostruiti da una risposta testuale del modello.

### 2. Corpus documentale con provenienza

Conservare ogni pagina o file come fonte originale immutabile per quella scansione e generare passaggi collegati alla fonte. Migliorare gradualmente i tagli basati solo sui caratteri: preferire sezioni HTML, titoli, paragrafi, elementi di lista e tabelle; per PDF mantenere pagina e intestazione. Ogni passaggio dovrebbe portare almeno `source_id`, URL o percorso, titolo, ordinal o pagina, data di acquisizione, hash, lingua, tipo di contenuto e stato di attendibilità. Una nuova scansione crea una revisione nuova e consente di rimuovere la vecchia senza perdere la tracciabilità.

### 3. Recupero ibrido, con semantica opzionale

Usare FTS5/BM25 come base locale sempre disponibile: è economico, rapido e trova con precisione nomi, prezzi, SKU e termini esatti. Forgecy offre anche un indice locale opzionale con MiniLM multilingue, versionato e quantizzato, e fonde i risultati lessicali e semantici con Reciprocal Rank Fusion. Questa versione non fa un reranking LLM: evita costi e trasferimenti aggiuntivi e lascia citazioni e testo originale come controllo. Anthropic riporta miglioramenti interni combinando BM25, embeddings, contestualizzazione dei passaggi e reranking, ma avverte che i parametri vanno provati sul proprio corpus. [Anthropic: Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval)

Gli embeddings dipendono dal modello: salvarne nome e revisione e rigenerarli quando cambia il modello. L’indice è ricostruibile dai passaggi locali; i record sono cancellati in cascata quando viene rimosso un passaggio. Il modello si scarica soltanto quando l’utente attiva e avvia l’indice semantico. Gli snapshot Drive escludono i vettori derivati per non moltiplicare lo spazio occupato: dopo il ripristino o il passaggio a un altro computer, la ricerca lessicale è immediatamente pronta e l’utente può ricostruire l’indice dalla schermata Impostazioni.

Non aggiungere ora un grafo della conoscenza. Offre vantaggi quando domande multi-hop su entità e relazioni sono un caso d’uso misurato; per Forgecy le offerte e i fatti approvati hanno già uno schema relazionale, mentre il contenuto libero si presta a recupero per passaggio. Evitare di portare nella build una dipendenza vettoriale nativa finché non è verificata su macOS, Windows e Linux: SQLite pubblica una nuova estensione vettoriale `vec1`, ma la sua presenza nella documentazione non dimostra che sia inclusa nella SQLite distribuita con ogni runtime Forgecy. [SQLite vec1](https://www.sqlite.org/vec1.html)

### 4. Pacchetto di contesto specifico per ogni agente

Prima di ogni chiamata costruire un pacchetto breve per quella fase, invece di serializzare l’intero workspace:

1. Vincoli invarianti: richiesta dell’utente, ruolo dell’agente e regole di sicurezza.
2. Fatti canonici pertinenti: profilo/voce e identità visiva, dossier e strategia correnti, offerta verificata selezionata.
3. Passaggi recuperati per la domanda specifica, con ID, titolo, data e URL/pagina.
4. Cronologia minima necessaria alla continuità del lavoro.

Analista, stratega, copywriter e revisore ricevono query di recupero diverse. Gli agenti successivi mantengono gli ID delle prove e possono chiedere altri passaggi se emerge una domanda nuova. Il sistema deve applicare un budget esplicito di token, deduplicare passaggi sovrapposti e indicare chiaramente quando non trova prove. Non inviare all’LLM venti fonti troncate solo per simulare l’accesso all’intero archivio: gli studi sui modelli a contesto lungo mostrano cali quando l’informazione utile è dispersa nel mezzo del prompt. [Liu et al., *Lost in the Middle*](https://arxiv.org/abs/2307.03172)

### 5. Provenienza, sicurezza e aggiornamento

Il testo importato dal web o dai file è dato non attendibile, mai istruzione per gli agenti. Conservare limiti di contesto, separatori chiari, client/source scope e citazioni. Una fonte rimossa o modificata deve scomparire subito dall’indice; i risultati memorizzati in cache devono essere invalidati alla variazione di `knowledge_revision`. OWASP documenta rischi specifici di poisoning, istruzioni nascoste e sovraccarico della finestra di contesto nei sistemi RAG. [OWASP RAG Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html)

### 6. Scelta fra parser OCR API e locale

In **Automatico**, Forgecy sceglie PaddleOCR-VL solo su piattaforme supportate con almeno 12 GB RAM e parser già installato; altrimenti sceglie l'API OpenRouter. L'utente può forzare **Solo locale** (mai fare fallback remoto) oppure **OpenRouter**. Il setup locale richiede `uv`, connessione e circa 8 GB liberi per ambiente/modelli; l'app comunica prerequisiti e stato. Lo spazio libero serve all'installazione, mentre il criterio automatico di esecuzione usa supporto piattaforma e RAM. La decisione non si basa solo sul modello di computer: le versioni Apple Silicon diverse non hanno tutte la stessa verifica upstream e le prestazioni dipendono dal documento.

OpenRouter è più semplice e non richiede un runtime Python; Mistral OCR è indicato a 0,002 USD/pagina, oltre al modello selezionato. Locale evita il trasferimento di file all'API OCR e il costo per pagina, ma richiede spazio, download e calcolo CPU. Il testo estratto può comunque essere inviato a un modello OpenRouter per la fase successiva di estrazione strutturata del catalogo: questa fase va considerata separatamente dall'OCR nella scelta privacy/costi. Nessuna versione OCR riceve automaticamente immagini o testo nel prompt dell'LLM se l'utente non ha configurato un provider per le funzioni AI.

L'aggiornamento segue il rilascio stabile ufficiale, usa versioni puntate e installazione isolata per release. Un nuovo ambiente e i suoi pesi devono superare un'inferenza sintetica prima del cambio atomico del puntatore. La versione attiva è conservata in caso di errore; le versioni precedenti vengono rimosse dopo la riuscita e quando nessun processo le usa. Non si aggiorna a prerelease, branch `main` o una versione non parsabile. È importante aggiungere in futuro una suite di benchmark italiana con PDF scansionati, tabelle catalogo e immagini di prodotto, perché lo smoke test protegge dall'installazione rotta ma non dimostra l'accuratezza su documenti reali.

## Piano di implementazione

1. **Recupero passage-level e ingestione strutturata — implementati.** FTS5 sui passaggi, migrazione dell’indice, struttura HTML, sezione del documento, test su corrispondenze in fonti lunghe e invalidazione dopo aggiornamenti.
2. **Pacchetti di evidenze per missione — implementati.** Le fasi recuperano prove diverse per brief, analisi, offerta e revisione; le evidenze mantengono gli ID e il controllo del Brand Guard usa il testo originale.
3. **Semantica locale opt-in — implementata.** MiniLM multilingue versionato, indice SQLite ricostruibile, batch limitati e fusione ibrida. FTS5 resta il percorso di riserva.
4. **Evaluation specifica sul corpus — da ampliare con uso reale.** I test attuali coprono query lessicali esatte, recupero di passaggi remoti, fusion ranking, aggiornamento/cancellazione e conservazione delle citazioni. Dopo aver raccolto domande anonime rappresentative del proprio lavoro, annotare i passaggi attesi e valutare Recall@5/MRR e copertura delle citazioni prima di modificare i pesi o attivare la modalità semantica per impostazione predefinita.
5. **OCR locale + API — implementati.** PaddleOCR-VL versionato, setup CPU isolato, analisi hardware, selezione automatica e override esplicito, aggiornamento stable staged, smoke test prima dell'attivazione e rimozione differita delle versioni non attive.
6. **Evaluation OCR — da ampliare con dati locali dell'utente.** Misurare qualità, tempo e RAM su documenti italiani rappresentativi; il test sintetico dell'installer controlla solo che il nuovo runtime funzioni.

## Criteri di accettazione

- Ogni passaggio recuperato ha un ID fonte valido e ogni citazione può risalire al testo originale.
- Una query che trova un’informazione in una sezione lontana restituisce quella sezione, non l’inizio del documento.
- Le missioni ricevono evidenze pertinenti alla loro fase e non dipendono dall’ordine di inserimento delle fonti.
- Le fonti cancellate, sostituite o non pronte non compaiono nel contesto AI.
- Il contesto inviato è misurato e limitato; il modello dichiara i dati mancanti invece di colmarli.
- Se gli embeddings sono attivi, il calcolo e l’indice sono locali, il modello è identificabile, i vettori si possono cancellare e ricostruire e gli snapshot Drive non li duplicano.
- La modalità semantica resta disattivata per impostazione predefinita finché query dorate rappresentative dell’uso reale non provano un miglioramento sulle parafrasi senza regressioni sui nomi e sui valori esatti.

## Fonti della ricerca

- [SQLite FTS5](https://www.sqlite.org/fts5.html) — tokenizer, BM25, snippet e pesi per colonna.
- [SQLite vec1](https://www.sqlite.org/vec1.html) — estensione ANN vector per SQLite, con distanze L2 e cosine.
- [Lewis et al., Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401) — paper fondativo sul recupero di conoscenza esterna per generazione.
- [Anthropic, Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval) — esperimenti aziendali su BM25, embeddings, contesto dei chunk e reranking.
- [Liu et al., Lost in the Middle](https://arxiv.org/abs/2307.03172) — risultati sul calo di utilizzo di prove sepolte in contesti lunghi.
- [Google Cloud, RAG and search APIs](https://docs.cloud.google.com/generative-ai-app-builder/docs/builder-apis) — separazione tra parsing, retrieval, ranking e generazione; riferimento utile, anche se il suo stack è cloud e non viene adottato da Forgecy.
- [OWASP, RAG Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html) — provenienza, limiti dei passaggi, protezione da document poisoning e istruzioni indirette.
- [Hugging Face Transformers.js: Node.js](https://huggingface.co/docs/transformers.js/en/tutorials/node) — esecuzione locale e cache configurabile del modello.
- [Modello MiniLM multilingue quantizzato](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/tree/main/onnx) — file ONNX quantizzati usati per l’indice locale.
- [OpenRouter, Universal PDF Support](https://openrouter.ai/blog/announcements/universal-pdf-support/) — estrazione testo e immagini con il motore `mistral-ocr`, indicato a 2 USD per 1.000 pagine.
- [OpenRouter, DeepSeek V4.1 Flash](https://openrouter.ai/deepseek/deepseek-v4.1-flash/providers) — supporta input di testo e immagini. È il modello visivo predefinito; il catalogo resta aggiornabile e selezionabile dall'app.
- [OpenRouter, Dolphin 3.0 Mistral 24B](https://openrouter.ai/cognitivecomputations/dolphin3.0-mistral-24b) — modello general purpose con modalità solo testuale nel catalogo, quindi non adatto a ricevere immagini direttamente per OCR. Il nome coincide con la famiglia documentale open source Dolphin, ma non indica lo stesso modello.
- [Docling, installazione](https://docling-project.github.io/docling/getting_started/installation/) e [motori OCR](https://docling-project.github.io/docling/concepts/OCR/) — supporto multipiattaforma con runtime PyTorch e backend OCR selezionabili.
- [PaddleOCR, installazione](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/installation.en.md) — dipendenze e motore d'inferenza selezionabili in base alle funzionalità necessarie.
