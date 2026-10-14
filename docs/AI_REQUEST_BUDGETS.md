# Quote locali per le richieste AI

Forgecy prenota quote prima delle chiamate AI in chat, adattamento, dossier, strategia, missioni e immagini. Le soglie sono ponderate per operazione e client e vengono applicate in modo atomico nel database SQLite locale. Una prenotazione non viene rimborsata in caso di errore, così i retry falliti non aggirano i limiti.

Queste quote limitano il numero ponderato di richieste, non il costo in euro o dollari. Una missione multi-agente può fare più chiamate a OpenRouter; il prezzo dipende dal modello, dall'uso e dal provider. Imposta eventuali tetti di spesa nel tuo account OpenRouter.

Il workspace non sincronizza le prenotazioni tra computer in tempo reale. La sincronizzazione Drive trasferisce snapshot del database quando l'utente la avvia; usa un solo computer alla volta e sincronizza prima del passaggio.
