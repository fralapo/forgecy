# Forgecy — stato e priorità

Aggiornato il 14 ottobre 2026. Forgecy è un progetto open source per uso personale: funziona in locale, conserva il workspace su SQLite e offre sincronizzazione facoltativa di snapshot su Google Drive. Non è un servizio ospitato né una piattaforma collaborativa.

## Funzioni presenti

- Profili client/brand, fonti e offerte verificate.
- Acquisizione sicura di siti e documenti: estrae in locale HTML, Markdown, CSV, PDF testuali e DOCX; usa OCR OpenRouter per PDF scannerizzati e immagini senza testo estraibile.
- Memoria locale in SQLite con passaggi citabili e recupero ibrido: FTS5 sempre disponibile e ricerca semantica MiniLM locale attiva di default, indicizzata in background e disattivabile.
- Riconciliazione dei cataloghi con le offerte esistenti, protezione dei campi modificati manualmente e associazione delle immagini prodotto quando l'evidenza è chiara.
- Dossier, strategie e proposte AI con stati e approvazione esplicita.
- Coda persistente in SQLite e worker locale, con quote, lease, retry e recupero dopo riavvio.
- Editor statico per Instagram/LinkedIn, calendario editoriale e export.
- Importazione manuale di snapshot Instagram e conteggio follower dall'archivio JSON dell'account proprietario; i nomi restano nel browser. Nessuno scraping o accesso automatico alla piattaforma.
- Cataloghi OpenRouter correnti per modelli testo e immagini, selezionabili da Impostazioni e salvati nel workspace.
- Export/import verificato, backup locali automatici a rotazione e snapshot immutabili Google Drive con scelta manuale in caso di conflitto.

## Limiti conosciuti

Drive sincronizza solo quando richiesto e trasferisce snapshot completi, inclusi i vettori semantici; non supporta modifica simultanea o merge automatico. I backup locali vengono creati all'avvio e poi ogni 8 ore mentre Forgecy è in uso; ne restano gli ultimi 7 sullo stesso computer. Non proteggono da guasto o perdita del disco: per una copia esterna usa esportazione o Drive. Ogni dispositivo conserva le proprie API key. I documenti escono dal dispositivo quando si seleziona OpenRouter; l'estrazione AI dei cataloghi è una fase separata. I dati d'uso restituiti sono parziali e non costituiscono un tetto monetario. Il modello semantico si scarica nella cache locale di ciascun computer; FTS5 resta sempre disponibile come fallback.

## Priorità successive

1. **Implementazione pronta; verifica reale in attesa della configurazione Google personale.** Il Client ID può essere salvato dalle impostazioni nella cartella dati privata del computer (oppure letto da `.env.local`); non entra nel workspace o nei backup. Il flusso desktop PKCE e il rifiuto dello state OAuth errato hanno test isolati. Per completare il ciclo servono ancora il progetto OAuth personale, il consenso sul computer host e la prova di sincronizzazione dal secondo computer.
2. **Completata su dati sintetici.** Prova live isolata con la chiave OpenRouter locale: PDF scannerizzato di una pagina, OCR Mistral, estrazione e riconciliazione AI (1 prodotto aggiornato, 1 aggiunto, 0 invalidi; costo riportato 0,002825 USD). Il test SQLite chiude e riapre il database e recupera il job scaduto con lease rinnovata. Nessun dato cliente è stato usato e la chiave non è stata stampata o scritta nel workspace.
3. **Completata in test isolato.** Due archivi completi con contenuti diversi e lo stesso snapshot antenato sono rilevati come teste divergenti; la copia locale è salvata prima del ripristino del ramo remoto, resta valida dopo il ripristino e conserva le modifiche specifiche del ramo locale. La sincronizzazione Google reale resta da provare con OAuth.
4. **Baseline pubblica iniziale completata; ampliare il corpus.** Due pagine del catalogo pubblico BioMatrix 2024–25: OCR corretto su 8/8 varianti di tabella, 1 prodotto aggiornato, 1 aggiunto, 0 invalidi e 2/2 abbinamenti foto verificati a vista; costo riportato 0,011219 USD. Sul listino pubblico Bosch 2025, pagina 2, il testo OCR rappresenta la tabella in Markdown. Il nuovo parser locale delle tabelle OCR ha superato due prove end-to-end consecutive senza chiamare il modello catalogo: entrambe hanno trovato 3/3 indicatori attesi e 1/1 riga test attesa, aggiunto 26 prodotti e scartato 0 righe. Tempi 28,957 s e 53,634 s; una richiesta API per prova e costi riportati 0,006284 e 0,008227 USD. Il workspace utente è rimasto intatto. Le prove AI precedenti su cataloghi non tabellari erano instabili; ora le risposte strutturate hanno ragionamento disattivato, timeout limitato e fallback testo quando il modello visivo non dà evidenze. L'OCR resta esclusivamente via API; CSV e tabelle Markdown OCR vengono riconciliati localmente con citazioni di riga verificate. Servono altri documenti italiani, controlli su tabelle irregolari e un corpus annotato rappresentativo per misurare accuratezza e tempi; le immagini non sono state collegate in queste prove Bosch perché l'OCR ha restituito solo l'immagine della pagina.

I controlli automatizzati sono in GitHub Actions. Google Drive e OpenRouter richiedono credenziali configurate dall'utente. Instagram accetta snapshot manuali e conteggi follower dall'archivio JSON dell'account proprietario; non estrae metriche dei post dall'archivio e non raccoglie dati da altri profili. Dettagli e limiti sono in INSTAGRAM_SNAPSHOTS.md.
