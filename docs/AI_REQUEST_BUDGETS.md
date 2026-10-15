# Richieste AI: quote Forgecy rimosse

Forgecy non applica quote temporali o giornaliere di richieste AI per cliente o workspace. Le prenotazioni AI e i relativi contatori SQLite sono stati rimossi. La pagina **Utilizzo AI** registra i dati di utilizzo comunicati dai provider per osservare il consumo; non blocca né autorizza le richieste.

OpenRouter e gli altri provider possono applicare i propri limiti di frequenza, disponibilità, credito e costo. Forgecy non può disattivare limiti imposti dal provider. Un errore del provider deve essere mostrato come errore del provider e non come quota Forgecy.

I job AI restano in coda locale e vengono riprovati in caso di errore secondo la configurazione di affidabilità del worker. Questi retry non sono quote di utilizzo. Le misure tecniche sui file e sul numero di pagine OCR sono documentate in [sicurezza dell'acquisizione documenti](DOCUMENT_INGEST_SECURITY.md).

Il workspace è locale e non sincronizza dati tra computer in tempo reale. Per trasferirlo si usa un archivio completo.
