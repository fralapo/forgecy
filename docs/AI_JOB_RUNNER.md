# Coda delle attività AI

Le bozze dossier e le missioni vengono salvate nel database SQLite e processate dal worker locale quando il server Forgecy è attivo. Non servono cron, dispatcher esterni o credenziali di servizio. Se il computer o Forgecy è spento, i job restano in coda e ripartono alla successiva esecuzione.

Il worker acquisisce un job con una lease e un token di tentativo, rinnova la lease durante l'elaborazione e controlla il token prima delle scritture finali. I job hanno limiti e tentativi; le approvazioni di dossier, strategie e contenuti restano azioni esplicite. Un arresto durante una richiesta AI può comunque comportare costi duplicati quando il job viene riprovato: non è possibile rendere atomica una chiamata a un provider esterno.

Le API workspace elencano, accodano e cancellano job ancora in coda. L'interfaccia aggiorna lo stato mentre il processo è in esecuzione. Per i requisiti e la configurazione OpenRouter vedere [LOCAL_SETUP.md](LOCAL_SETUP.md).

I test coprono idempotenza, limiti, lease, scadenza e transizioni di stato in SQLite. Le prove CI non simulano costi o disponibilità reali di OpenRouter.
