# Stato implementazione

Forgecy viene eseguito sul computer dell'utente con un workspace SQLite locale. Il database, le preferenze AI, le attività in coda e i file non richiedono servizi remoti. Le chiamate a OpenRouter e le integrazioni social usano le credenziali personali configurate localmente.

L'app include gestione client e fonti, dossier e strategie approvabili, missioni AI in coda, editor statico social, cataloghi OpenRouter live, contatori di utilizzo e import/export del workspace. Google Drive è opzionale: OAuth desktop, scope limitato ai file creati/aperti da Forgecy, snapshot con hash e flusso esplicito di risoluzione conflitti.

Per installare, avviare e collegare Drive seguire [LOCAL_SETUP.md](LOCAL_SETUP.md). Le verifiche automatiche sono typecheck, lint, test Node e build Next.js. Non convalidano le credenziali o i flussi OAuth live dell'installazione.
