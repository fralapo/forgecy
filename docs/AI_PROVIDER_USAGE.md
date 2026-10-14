# Uso dei modelli AI

Forgecy registra localmente le osservazioni di utilizzo restituite da OpenRouter per client, operazione e modello. Se l'API restituisce token o costo, questi valori possono comparire in **Risultati → Utilizzo dei modelli AI**; dati mancanti restano sconosciuti e non vengono stimati da un listino.

La registrazione avviene dopo la risposta del provider e non la blocca se fallisce. Timeout, arresti del processo o risposte senza metadati possono lasciare osservazioni incomplete. I totali sono indicativi e parziali: non sono fatture né limiti di spesa. Configura limiti e avvisi direttamente sul tuo account OpenRouter.

Prompt, contenuti generati e chiavi API non vengono inseriti nel registro. Il database e il registro restano nella cartella locale e sono inclusi negli snapshot; le chiavi OpenRouter restano nella configurazione locale e non vengono esportate.

Per impostare la chiave e scegliere i cataloghi correnti di testo e immagini, vedere [LOCAL_SETUP.md](LOCAL_SETUP.md).
