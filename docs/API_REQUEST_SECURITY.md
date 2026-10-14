# Sicurezza delle API locali

Forgecy è progettato per un solo proprietario e lega il server a `127.0.0.1`. L'accesso locale continua a usare il loopback. L'accesso remoto opzionale passa da Tailscale Serve in HTTPS, richiede l'header di identità Tailscale e confronta il login con `FORGECY_TAILSCALE_ALLOWED_USER`. Accetta solo l'hostname esatto definito da `FORGECY_TAILSCALE_HOST`; host esterni e richieste senza l'identità attesa vengono rifiutati. Il controllo `Origin` same-origin continua a proteggere le mutazioni API e, da remoto, lo confronta con quell'hostname.

Le API JSON leggono il corpo in streaming, applicano il limite di 200.000 byte e validano i dati con Zod. Gli upload hanno limiti più stretti e verificano tipo e firma del file. I file privati restano nella cartella dati; gli URL di lettura sono firmati e hanno breve durata.

Per l'uso solo locale, con `npm run start` imposta `APP_ORIGIN=http://localhost:3000` in `.env.local`. Per il percorso Tailscale, mantieni Forgecy su loopback, configura il login proprietario in `FORGECY_TAILSCALE_ALLOWED_USER`, l'hostname HTTPS esatto mostrato da `tailscale serve status` in `FORGECY_TAILSCALE_HOST` e usa `npm run dev:tailscale` o `npm run start:tailscale`, che ascoltano sulla porta 7693. La porta non va esposta sulla LAN, su Internet o tramite Funnel. La protezione con header di identità presume che solo il demone Tailscale Serve possa raggiungere il backend remoto; il server deve quindi rimanere su loopback. Non protegge da processi ostili già in esecuzione sul computer.

Google Drive usa un callback OAuth temporaneo su un socket `127.0.0.1` e PKCE. I token non sono trasmessi al browser di Forgecy né inclusi negli archivi. Per i dettagli, consultare [LOCAL_SETUP.md](LOCAL_SETUP.md).
