# Forgecy V21 — nota storica

Questo documento conserva il contesto di un'integrazione precedente. La linea attuale è stata convertita a SQLite locale; i dettagli di installazione storici non sono più istruzioni operative. Seguire [LOCAL_SETUP.md](LOCAL_SETUP.md) per la versione corrente.

Il lavoro V21 consolidava ricerca di fonti, quote di acquisizione web e job AI con lease e token di fencing. Le stesse garanzie applicative sono ora implementate nel runtime locale e verificate con test SQLite.

Le garanzie rimangono limitate alle transazioni del database locale: non rendono atomiche le richieste a un provider AI né impediscono costi ripetuti dopo un arresto durante una chiamata.
