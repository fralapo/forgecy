# Sicurezza delle API locali

Forgecy è progettato per un solo proprietario sul computer locale e lega il server a `127.0.0.1`. `proxy.ts` rifiuta host non loopback e blocca mutazioni API cross-origin con un controllo `Origin` same-origin. Questo riduce richieste inviate da siti esterni attraverso il browser; non è un sistema di autenticazione per un server esposto in rete.

Le API JSON leggono il corpo in streaming, applicano il limite di 200.000 byte e validano i dati con Zod. Gli upload hanno limiti più stretti e verificano tipo e firma del file. I file privati restano nella cartella dati; gli URL di lettura sono firmati e hanno breve durata.

Con `npm run start`, imposta `APP_ORIGIN=http://localhost:3000` in `.env.local`. Il server va mantenuto su loopback. Non fare port forwarding, non esporlo su un dominio pubblico e non considerare l'header Origin come protezione contro un client locale ostile.

Google Drive usa un callback OAuth temporaneo su un socket `127.0.0.1` e PKCE. I token non sono trasmessi al browser di Forgecy né inclusi negli archivi. Per i dettagli, consultare [LOCAL_SETUP.md](LOCAL_SETUP.md).
