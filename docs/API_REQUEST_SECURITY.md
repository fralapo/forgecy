# Forgecy V23 — protezione delle operazioni API e limiti del corpo JSON

## Modifiche introdotte

La nuova protezione in `proxy.ts` controlla in ingresso tutte le richieste **non GET/HEAD/OPTIONS** a `/api/`, **prima** del refresh della sessione Supabase.

- Controllo `Origin` contro l'origine canonica dell'applicazione: `APP_ORIGIN`.
- Blocco di `Origin` mancante o `null`, origine di altri domini e richieste con `Sec-Fetch-Site: same-site` o `cross-site`.
- Un `APP_ORIGIN` non impostato in produzione produce un errore di configurazione HTTP 503 sulle sole API di scrittura, non un bypass silenzioso.
- `APP_ORIGIN` HTTP è ammessa in produzione soltanto per `localhost` / `127.0.0.1`; usare HTTPS su domini pubblici.
- Le rotte GET (es. callback OAuth e dispatcher con CRON_SECRET) non sono modificate. Per futuri webhook server-to-server, progettare un canale dedicato con verifica della firma, senza disattivare globalmente il controllo.

`lib/http.ts:read` ora applica un **limite di 200.000 byte effettivi** al JSON del corpo mediante lettura incrementale dallo stream, anche se il client omette `Content-Length` o ne dichiara uno falso. Il JSON deve essere UTF-8 valido e avere `Content-Type: application/json` (o un tipo `+json` compatibile). Il parsing resta validato da Zod.

## Configurazione

Per l’uso personale locale imposta in `.env.local` (necessario anche con `npm run start`):

```env
APP_ORIGIN=http://localhost:3000
```

Un build “production” di Next.js può girare sul tuo computer: non implica un servizio pubblico né un secondo ambiente. Se scegli un deploy pubblico imposta invece:

```env
APP_ORIGIN=https://dominio-pubblico-forgecy.example
```

Il valore deve essere **l'origine esatta, senza slash finale e senza path**. Se l'app ha più domini o ambienti di preview, imposta una variabile ambiente per ciascun ambiente, con il relativo dominio effettivo; non usare un elenco di wildcard.

Gli script o client API che effettuano scritture devono inviare `Origin: https://dominio-pubblico-forgecy.example` e autenticarsi normalmente. Questo header non è un meccanismo di autenticazione per client non-browser; restano obbligatori Supabase Auth e RLS.

Durante `npm run dev`, senza `APP_ORIGIN`, Forgecy usa l'origine richiesta come fallback, per ridurre l'attrito dello sviluppo locale. **Non è previsto questo fallback in produzione.**

## Test

`tests/unit/api-request-guard.test.ts` verifica:

- Scritture same-origin consentite e richieste cross-site / same-site / null bloccate.
- GET e pagine non API non bloccate.
- Produzione senza `APP_ORIGIN` in modalità fail-closed.
- JSON valido, Content-Type scorretto, UTF-8 invalido e corpo JSON più grande del limite sia con Content-Length omesso sia dichiarato falso.
- Multipart valido, corpo superiore a 11 MB, boundary mancante e dimensioni dichiarate false.

## Limiti residuali

Questa misura rafforza le API cookie-authenticated ma non sostituisce autenticazione, RLS, permessi API, autorizzazione client-side e scadenza sessioni. Va affiancata a CORS volutamente restrittivo, CSP, rate limit distribuito, cookie SameSite e una verifica dei flussi reali nella propria installazione. `Origin` è forgibile da client non-browser, quindi non è una protezione contro un attaccante già autenticato che controlli un client HTTP.

Gli upload multipart passano ora attraverso `readMultipartForm`: **massimo 11 MB effettivi** letti in streaming prima che `formData()` inizi il parsing, anche con `Content-Length` mancante o dichiarato falso. Restano necessari limiti reverse proxy/WAF per bloccare richieste troppo grandi prima che arrivino al processo applicativo.

## Dipendenze

Integrata su `main` attraverso la release V24 (#100). Nessuna migrazione SQL aggiuntiva per questa protezione; l’app corrente richiede l’intera sequenza 0001–0017.
