# Memoria locale e recupero delle conoscenze per gli agenti

**Decisione:** Forgecy adotta una memoria locale centrata sulle evidenze e un recupero ibrido progressivo. SQLite resta la fonte di verità; i dati strutturati e approvati restano strutturati; la ricerca sui documenti lavora sui singoli passaggi. FTS5 è sempre disponibile. La ricerca semantica locale è attiva per impostazione predefinita e si combina con il ranking lessicale; il proprietario può disattivarla. Il modello si scarica e l'indice si costruisce in background solo quando esistono passaggi da indicizzare. Non serve introdurre un database RAG ospitato o inviare automaticamente i documenti a un servizio di embeddings.

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
- La scheda del modello identifica `paraphrase-multilingual-MiniLM-L12-v2` come modello Sentence Transformers per similarità/ricerca semantica, con embedding da 384 dimensioni e supporto dichiarato per 50 lingue. Il solo ONNX quantizzato alla revisione fissata nel codice pesa 118 MB; tokenizer e runtime portano il download complessivo a circa 120–130 MB. È un modello generale, non valutato sulle fonti reali di Forgecy.
- Il recupero ibrido è attivo per impostazione predefinita. FTS5 dà subito risultati lessicali; il worker locale prepara l'indice vettoriale a lotti solo quando ci sono passaggi pronti. Prima che l'indice sia pronto e in caso di errore o assenza di rete, Forgecy continua con FTS5. La query semantica viene calcolata sul computer e non invia il testo a un servizio di embeddings.
- FTS5 usa BM25 e supporta ricerca di termini, frasi e combinazioni; il recupero semantico può coprire parafrasi e vocabolario diverso. Nessuna fonte generale dimostra che il ranking ibrido migliori tutte le query del corpus Forgecy: la valutazione specifica sul corpus resta necessaria, in particolare per prezzi, SKU e nomi esatti.
- Il dossier controlla gli ID delle fonti e richiede che le citazioni dichiarate come verificate corrispondano a testo effettivo.
- Chat recupera passaggi per la domanda e il dossier interroga più temi. Le fasi di missione ora recuperano prove in base al brief, all’analisi strategica, all’offerta e alle bozze da controllare; il Brand Guard riceve i passaggi originali pertinenti invece di un dump delle prime fonti.

## Struttura raccomandata

### 1. Memoria strutturata e autorevole

Continuare a usare i record esistenti per cliente, profilo e voce del brand, asset del logo e palette, offerte, dossier, strategia approvata, segnali social e stato delle fonti. A ogni valore importante associare stato (bozza, verificato, approvato), provenienza, data e revisione della conoscenza. Prezzi, disponibilità, ingredienti e benefici verificati vanno letti dai record strutturati, non ricostruiti da una risposta testuale del modello.

### 2. Corpus documentale con provenienza

Conservare ogni pagina o file come fonte originale immutabile per quella scansione e generare passaggi collegati alla fonte. Migliorare gradualmente i tagli basati solo sui caratteri: preferire sezioni HTML, titoli, paragrafi, elementi di lista e tabelle; per PDF mantenere pagina e intestazione. Ogni passaggio dovrebbe portare almeno `source_id`, URL o percorso, titolo, ordinal o pagina, data di acquisizione, hash, lingua, tipo di contenuto e stato di attendibilità. Una nuova scansione crea una revisione nuova e consente di rimuovere la vecchia senza perdere la tracciabilità.

### 3. Recupero ibrido, con semantica attiva e disattivabile

Usare FTS5/BM25 come base locale sempre disponibile: è rapido e adatto a nomi, prezzi, SKU e termini esatti. Il modello MiniLM multilingue aggiunge copertura per sinonimi e parafrasi e i risultati vengono fusi con Reciprocal Rank Fusion, senza confronto diretto dei punteggi. Il modello è locale, quantizzato e fissato a una revisione; non c'è un costo per query né un provider di embeddings esterno. Il default ibrido riduce il passaggio obbligatorio nelle Impostazioni, mentre la preferenza resta disattivabile. La documentazione del modello certifica il task generale, non l'accuratezza sulle fonti Forgecy; il ranking combinato deve quindi essere misurato con query reali. [Model card MiniLM multilingue](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2), [SQLite FTS5/BM25](https://www.sqlite.org/fts5.html), [Out-of-Domain Zero-Shot Hybrid Retrieval](https://arxiv.org/abs/2201.10582).

Ogni embedding ha 384 float32: circa 1.536 byte per passaggio, oltre all'overhead SQLite. I vettori sono derivati ma richiedono calcolo per essere rigenerati: per rendere un trasferimento Drive o un archivio pronto senza reindicizzazione, gli archivi includono i vettori insieme alle fonti e ai passaggi. Il file del modello (circa 118 MB per il solo ONNX quantizzato, oltre ai file di supporto) resta nella cache locale di ciascun computer e si scarica una volta per dispositivo; Transformers.js consente di collocare la cache su disco. I vettori vengono salvati con ID del modello e dimensioni; al cambio di revisione del modello occorre invalidare e ricostruire l'indice. Il limite archivio Forgecy resta 250 MB, quindi corpus molto grandi possono richiedere di ridurre il contenuto o una futura opzione per omettere i vettori.

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
3. **Semantica locale attiva di default — implementata.** MiniLM multilingue fissato a revisione, indice SQLite generato in background a lotti, fusione ibrida disattivabile e FTS5 come fallback. I vettori sono inclusi negli archivi e negli snapshot Drive; i pesi del modello restano per dispositivo.
4. **Evaluation specifica sul corpus — baseline sintetica disponibile, corpus reale ancora necessario.** I test unitari coprono query lessicali, fusion ranking, aggiornamento/cancellazione e citazioni. `npm run evaluate:retrieval` valuta il modello MiniLM fissato su otto coppie sintetiche italiane/inglesi e stampa MRR, Recall@3 e ranghi per categoria, senza aprire il workspace né inviare testi a un servizio remoto. Sulla baseline attuale: MRR 0,875 e Recall@3 1,00; una query parafrastica inglese/italiano e una sulla conservazione del siero si sono classificate seconde. Questo verifica il comportamento generale, ma non predice la qualità sui documenti dell'utente. Per decidere i pesi della fusione servono query e passaggi attesi annotati su un corpus rappresentativo, separando parafrasi, domande multilingui, codici, prezzi e nomi esatti.
5. **OCR locale + API — implementati.** PaddleOCR-VL versionato, setup CPU isolato, analisi hardware, selezione automatica e override esplicito, aggiornamento stable staged, smoke test prima dell'attivazione e rimozione differita delle versioni non attive.
6. **Evaluation OCR — da ampliare con dati locali dell'utente.** Misurare qualità, tempo e RAM su documenti italiani rappresentativi; il test sintetico dell'installer controlla solo che il nuovo runtime funzioni. I documenti riservati del workspace non vengono inclusi nei test o nei report automatici.

## Criteri di accettazione

- Ogni passaggio recuperato ha un ID fonte valido e ogni citazione può risalire al testo originale.
- Una query che trova un’informazione in una sezione lontana restituisce quella sezione, non l’inizio del documento.
- Le missioni ricevono evidenze pertinenti alla loro fase e non dipendono dall’ordine di inserimento delle fonti.
- Le fonti cancellate, sostituite o non pronte non compaiono nel contesto AI.
- Il contesto inviato è misurato e limitato; il modello dichiara i dati mancanti invece di colmarli.
- La ricerca semantica è abilitata di default, ma non deve bloccare l'uso iniziale: FTS5 funziona subito e il worker costruisce i vettori in background; è possibile disabilitarla.
- Gli embedding usano un modello locale fissato, vengono inclusi negli archivi entro il limite dimensionale Forgecy e possono essere ricostruiti dalle fonti; i modelli restano nella cache privata locale.
- Valutare il recupero ibrido su query rappresentative prima di cambiare i pesi RRF; controllare separatamente parafrasi, codici, prezzi, nomi e copertura delle citazioni.

## Fonti della ricerca

- [SQLite FTS5](https://www.sqlite.org/fts5.html) — tokenizer, BM25, snippet e pesi per colonna.
- [Sentence Transformers multilingual MiniLM model card](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2) — 50 lingue dichiarate, embedding da 384 dimensioni e task di similarità/ricerca semantica.
- [Transformers.js in Node.js](https://huggingface.co/docs/transformers.js/main/tutorials/node) — download e cache locale del modello, configurabile con `env.cacheDir`.
- [MiniLM quantizzato alla revisione usata da Forgecy](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/blob/b9e20f0c6dd7e5f88c72259765011e6a3a9196bc/onnx/model_quantized.onnx) — file ONNX da 118 MB.
- [Zero-Shot Hybrid Retrieval](https://arxiv.org/abs/2201.10582) — risultati comparativi su benchmark fuori dominio, non sostitutivi di una valutazione sul corpus Forgecy.
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
