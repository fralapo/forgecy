# Ricerca nelle fonti

Quando un client accumula pagine e documenti, Forgecy suddivide i testi pronti in estratti attribuibili alla fonte e usa la ricerca lessicale FTS5 di SQLite per recuperare passaggi pertinenti. La ricerca lessicale può non trovare sinonimi o parafrasi e non verifica autonomamente la veridicità delle affermazioni.

La reindicizzazione segue la creazione, modifica o estrazione di una fonte. Le risposte AI ricevono gli estratti con i relativi riferimenti; i contenuti originali restano file locali. Nuove revisioni della conoscenza rendono obsolete le analisi approvate precedenti.

Limiti e qualità dipendono da testo effettivamente estratto: PDF scannerizzati non sono sottoposti a OCR automatico. Per formati, limiti upload e dati locali, consultare [DOCUMENT_INGEST_SECURITY.md](DOCUMENT_INGEST_SECURITY.md) e [LOCAL_SETUP.md](LOCAL_SETUP.md).
