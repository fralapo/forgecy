# Memoria locale e recupero delle conoscenze per gli agenti

**Decisione:** Forgecy adotta una memoria locale centrata sulle evidenze e un recupero ibrido progressivo. SQLite resta la fonte di verità; i dati strutturati e approvati restano strutturati; la ricerca sui documenti lavora sui singoli passaggi. FTS5 è sempre disponibile. La ricerca semantica locale è attiva per impostazione predefinita e si combina con il ranking lessicale; il proprietario può disattivarla. Il modello si scarica e l'indice si costruisce in background solo quando esistono passaggi da indicizzare. Non serve introdurre un database RAG ospitato o inviare automaticamente i documenti a un servizio di embeddings.

Per l'OCR Forgecy legge in locale il testo già incorporato nei documenti. Se un PDF scannerizzato o un'immagine non contiene testo leggibile, invia il file a OpenRouter per un'elaborazione una tantum durante il caricamento. Non installa né esegue un motore OCR locale. La fase successiva di estrazione strutturata del catalogo è separata e può inviare testo e immagini al modello AI selezionato.

## Perché questa scelta

Forgecy è single-user e local-first: SQLite e gli asset sul disco sono il workspace autorevole; Drive trasferisce snapshot manuali tra computer. Spostare la memoria in un servizio vettoriale cloud aggiungerebbe costi, credenziali e un secondo posto in cui conservare contenuti dei clienti, senza risolvere da solo la qualità delle risposte.

RAG è il pattern giusto per le domande che richiedono di trovare passaggi in siti, PDF, note e documenti. Non deve però sostituire le tabelle già affidabili per offerte verificate, identità del brand, revisioni e dossier approvati. Il dossier è una sintesi controllabile da una persona; le fonti con provenienza sono le prove; il recupero porta all’agente soltanto i passaggi pertinenti al compito.

## Stato attuale verificato nel codice

- Le fonti sono salvate in SQLite e suddivise in passaggi da circa 1.500 caratteri, mantenendo paragrafi e titoli quando possibile, con collegamento alla fonte, numero del passaggio e sezione.
- SQLite FTS5 fornisce ricerca full-text e ranking BM25; la documentazione ufficiale supporta ranking per colonne, snippet e tokenizer Unicode. [SQLite FTS5](https://www.sqlite.org/fts5.html)
- Chat, dossier e fasi di missione interrogano la memoria con domande mirate. Una corrispondenza nel mezzo di una fonte lunga viene restituita come passaggio, non sostituita dall’inizio del documento.
- La ricerca lessicale indicizza e classifica ciascun passaggio. La migrazione locale ricostruisce l’indice esistente e aggiunge i metadati di sezione.
- L’acquisizione HTML conserva titoli, paragrafi, liste e righe di tabella. L’importazione dei file mantiene i metadati della fonte; ogni passaggio resta verificabile sul testo originale.
- PDF testuali e documenti leggibili vengono estratti in locale. Se un PDF o un'immagine non contiene testo estraibile, il file viene inviato a OpenRouter usando il modello OCR selezionato. Serve una chiave configurata; il documento viene elaborato fuori dal computer e il provider può applicare costi correnti per pagina o modello. L'OCR avviene una volta per caricamento; la successiva estrazione AI del catalogo è separata.
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

### 6. OCR documentale tramite API

L'estrazione nativa locale resta il primo passaggio. Se non restituisce testo, Forgecy invia il PDF o l'immagine a OpenRouter con il modello OCR selezionato; se chiave o chiamata non sono disponibili, la fonte resta in sospeso e può essere riprovata. Questo evita il runtime locale che, nelle prove sul computer di sviluppo, ha impiegato troppo tempo anche per una singola pagina. L'invio comporta elaborazione esterna e possibili costi secondo la tariffa aggiornata del provider. L'eventuale estrazione AI strutturata dei prodotti è una richiesta separata, necessaria solo per cataloghi da riconciliare.

## Piano di implementazione

1. **Recupero passage-level e ingestione strutturata — implementati.** FTS5 sui passaggi, migrazione dell’indice, struttura HTML, sezione del documento, test su corrispondenze in fonti lunghe e invalidazione dopo aggiornamenti.
2. **Pacchetti di evidenze per missione — implementati.** Le fasi recuperano prove diverse per brief, analisi, offerta e revisione; le evidenze mantengono gli ID e il controllo del Brand Guard usa il testo originale.
3. **Semantica locale attiva di default — implementata.** MiniLM multilingue fissato a revisione, indice SQLite generato in background a lotti, fusione ibrida disattivabile e FTS5 come fallback. I vettori sono inclusi negli archivi e negli snapshot Drive; i pesi del modello restano per dispositivo.
4. **Evaluation specifica sul corpus — baseline pubblica e sintetica disponibile; corpus cliente ancora necessario.** `npm run evaluate:retrieval` costruisce in SQLite in-memory l'indice FTS5 con lo stesso tokenizer e i pesi del recupero in produzione, calcola gli embedding locali e confronta ranking lessicale, semantico e la funzione RRF di Forgecy. Non apre il workspace né invia testi a un servizio remoto. Il fixture ha 12 query annotate: otto esempi generali sintetici e quattro passaggi verificabili dal [listino Bosch 2025](https://www.bosch-industrial.com/it/media/country_pool/documenti/listino_2025_large_commercial_8738400436.pdf), su SKU/prezzi e dati tecnici. Risultato baseline: hybrid MRR 0,917 e Recall@3 1,00; semantico 0,917/1,00; lessicale 0,583/0,583. Le quattro query Bosch si sono classificate al primo posto con tutte e tre le strategie. Il campione è piccolo e curato: non prova la qualità sui documenti dell'utente né giustifica cambiare i pesi RRF; servono query e passaggi attesi annotati su un corpus rappresentativo e riservato-localmente, separando parafrasi, lingue, codici, prezzi, nomi e copertura delle citazioni.
5. **OCR API — implementato.** Estrazione nativa locale e OCR OpenRouter per scansioni/immagini senza testo. Il motore OCR locale è stato rimosso dopo una prova lenta; non esiste installazione o fallback OCR locale.
6. **Evaluation OCR — baseline reale pubblica iniziale disponibile; corpus più ampio ancora necessario.** Misurare accuratezza, tempi e costi API su documenti italiani rappresentativi; i documenti riservati del workspace non vengono inclusi nei test o nei report automatici.

Per una prova live isolata della pipeline documentale è disponibile `npm run evaluate:document-live -- --live`: usa un PDF scansionato sintetico di una pagina, la chiave già configurata nel portachiavi locale e i modelli attualmente selezionati, ma crea il cliente e i prodotti solo in un database temporaneo che viene eliminato al termine. Invia fino a due richieste a OpenRouter (OCR e catalogo) e stampa l'eventuale costo riportato dal provider. Il 14 ottobre 2026 la prova ha letto il PDF con Mistral OCR, aggiornato un prodotto, aggiunto il secondo e rifiutato zero righe; il costo riportato è stato 0,002825 USD. È una verifica end-to-end della pipeline, non una misura generale dell'accuratezza OCR. Non usare documenti o testi riservati in questo comando.

Per un PDF esplicitamente autorizzato a essere elaborato da OpenRouter, `npm run evaluate:document-file -- --live --allow-external-processing --input-pdf <percorso> [--seed-existing-name "nome prodotto"]` esegue lo stesso percorso upload/OCR/catalogo in un database temporaneo. Il comando richiede due flag di consenso, accetta PDF fino a 10 MB, legge la chiave solo dal portachiavi/configurazione locale e riporta contatori, costo e presenza dei termini/righe attesi, senza stampare il testo o la chiave. Passa `--expect-text <testo>` e `--expect-row <codice>` una volta per ogni valore atteso; il report restituisce solo quanti sono stati trovati. `--keep-image-evidence` conserva le immagini associate per un controllo visivo manuale. Non invia automaticamente file del workspace.

Baseline pubblica del 14 ottobre 2026: due pagine (49–50 del PDF) del [catalogo BioMatrix 2024–25](https://www.biomatrix.it/wp-content/uploads/2024/11/Catalogo-BioMatrix-2024-25_sch_001.pdf), temporaneamente rasterizzate per simulare scansioni e non conservate nel repository. Mistral OCR ha riconosciuto Baby Prone/BabyNest, i rispettivi codici e tutte le 8 varianti di taglia (4+4); l'estrazione ha aggiornato un prodotto, aggiunto l'altro e segnato zero righe invalide. I due prodotti sono stati collegati a due immagini distinte; una verifica visiva ha confermato entrambi gli abbinamenti. Il provider ha riportato 0,011219 USD per l'esecuzione di verifica. Questa prova su due pagine pubbliche non sostituisce un corpus multiformato annotato.

Diagnostica aggiuntiva sul [listino Bosch 2025](https://www.bosch-industrial.com/it/media/country_pool/documenti/listino_2025_large_commercial_8738400436.pdf), pagina 2 rasterizzata: l'OCR API ha letto il PDF scannerizzato e tutti e 3 gli indicatori testuali attesi sono stati trovati con confronto alfanumerico. Le esecuzioni complete non sono ancora ripetibili: una prova ha elaborato il catalogo, mentre le successive hanno incontrato JSON incompleto, risposta fuori schema o errore durante la richiesta. L'ultima è durata 101.465 ms, con 2 richieste e 0,007623 USD riportati; il catalogo non è stato importato e il workspace utente non è stato modificato. La deduplicazione tra varianti appena aggiunte è stata corretta; la baseline resta aperta finché un'importazione riuscita non è ripetibile.

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
- [Bosch, Listino Large Split Commercial 2025](https://www.bosch-industrial.com/it/media/country_pool/documenti/listino_2025_large_commercial_8738400436.pdf) — fonte primaria delle quattro query catalogo annotate nel fixture locale di retrieval.
- [OpenRouter, Universal PDF Support](https://openrouter.ai/blog/announcements/universal-pdf-support/) — estrazione testo e immagini con il motore `mistral-ocr`; tariffe e disponibilità possono variare.
- [OpenRouter, DeepSeek V4.1 Flash](https://openrouter.ai/deepseek/deepseek-v4.1-flash/providers) — supporta input di testo e immagini. È il modello visivo predefinito; il catalogo resta aggiornabile e selezionabile dall'app.
- [OpenRouter, Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs) e [Response Healing](https://openrouter.ai/docs/guides/features/plugins/overview) — JSON Schema e plugin per riparare output JSON malformati; il recupero testo-only di Forgecy resta convalidato separatamente dalle citazioni nel documento.
