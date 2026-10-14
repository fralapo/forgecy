# Stato implementazione

Forgecy viene eseguito sul computer dell'utente con un workspace SQLite locale. Il database, le preferenze AI, le attività in coda e i file non richiedono servizi remoti. Le chiamate a OpenRouter e le integrazioni social usano le credenziali personali configurate localmente.

L'app include gestione client e fonti, dossier e strategie approvabili, missioni AI in coda, editor statico social, cataloghi OpenRouter live, contatori di utilizzo e import/export del workspace. La schermata di trasferimento usa archivi manuali e backup automatici configurabili. Le vecchie API OAuth Drive restano nel repository ma non sono esposte nell'interfaccia.

Per installare, avviare e configurare i backup seguire [LOCAL_SETUP.md](LOCAL_SETUP.md). Le verifiche automatiche sono typecheck, lint, test Node e build Next.js. Non convalidano le credenziali OpenRouter dell'installazione o la sincronizzazione effettiva del client cloud del computer.
