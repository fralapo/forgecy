# Ricerca nelle fonti

Quando un client accumula pagine e documenti, Forgecy estrae prima il contenuto sul dispositivo, poi suddivide i testi in passaggi attribuibili alla fonte. La ricerca lessicale FTS5 di SQLite è sempre disponibile; l'utente può aggiungere l'indice semantico locale MiniLM dalle Impostazioni. I due ranking vengono fusi quando l'indice semantico è pronto. Il recupero migliora la copertura di sinonimi e parafrasi, ma non verifica da solo la veridicità delle affermazioni.

La reindicizzazione segue la creazione, modifica o estrazione di una fonte. Le risposte AI ricevono gli estratti con i relativi riferimenti; i contenuti originali restano file locali. Nuove revisioni della conoscenza rendono obsolete le analisi approvate precedenti.

I PDF scannerizzati e le immagini possono usare OCR OpenRouter, solo con chiave configurata e modello visivo selezionato. È un'elaborazione remota e può avere costi del provider; senza OCR riuscito la fonte rimane pending e non entra nel contesto degli agenti. Per provenienza e limiti consultare [KNOWLEDGE_ARCHITECTURE.md](KNOWLEDGE_ARCHITECTURE.md), [DOCUMENT_INGEST_SECURITY.md](DOCUMENT_INGEST_SECURITY.md) e [LOCAL_SETUP.md](LOCAL_SETUP.md).
