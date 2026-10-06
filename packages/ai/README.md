# @forgecy/ai

Gateway AI di Forgecy. **Nessuna parte di Forgecy chiama un provider direttamente**: tutto passa da `createAiGateway()`.

```ts
const providers = createProvidersFromEnv(env);
const ai = createAiGateway({
  ledger: createDbLedger(db),
  providers,
  routing: defaultRoutingFromEnv(env, providers),
  logger,
});
const { data } = await ai.generateObject({
  task: "outline",
  schema,
  system,
  input,
  clientId,
  clientPolicy,
  authorizedBy,
});
```

## Regole

- **Policy prima di tutto**: `checkAiPolicy` (da `@forgecy/core`) viene applicata prima di ogni richiesta. `no_ai` blocca; `local_only` usa solo `routing.local` e, se manca, si ferma con un errore chiaro (mai fallback al cloud); `external_restricted` usa solo i provider approvati.
- **Budget**: prima di ogni job si somma la spesa del mese da `jobs_log` per agenzia e cliente. Avviso a `warn_at_percent`, blocco al 100% con `ForgecyError("budget_exceeded")`.
- **Output strutturato**: lo schema Zod diventa JSON Schema (`z.toJSONSchema`), il provider lo riceve nel suo formato (Anthropic `output_config.format`, OpenAI-compatibili `response_format: json_schema`), e la risposta passa sempre da Zod. Se fallisce, un secondo tentativo riceve l'errore di validazione; dopo 2 errori il job fallisce.
- **Errori**: riprovabili (429, 5xx, rete, timeout) e rifiuti → fallback del task, se la policy lo consente. Non riprovabili (400, auth) → errore subito. `max_tokens` → errore esplicito. Gli SDK ritentano già 429/5xx internamente (`maxRetries`).
- **Log**: ogni tentativo, anche bloccato, scrive una riga in `jobs_log`: provider, modello, policy, chi ha autorizzato, token, costo in micro-USD e `input_summary` con **nomi dei campi, dimensioni e hash SHA-256, mai il contenuto**. Per dati aggiuntivi usa `inputSummary.fields` (vengono hashati) o `meta` (solo valori non sensibili).
- **Prezzi**: `src/pricing.ts` è una tabella modificabile. Va verificata sulle pagine dei provider; i modelli assenti costano 0 e sono segnalati (`unpriced: true`).
- **Chiavi BYOK**: `encryptSecret` / `decryptSecret` (AES-256-GCM con `FORGECY_ENCRYPTION_KEY`); in chiaro solo `keyHint` (ultimi 4 caratteri). Mai nei log.

## Aggiungere un provider

1. Se è compatibile con l'API OpenAI, basta `createOpenAICompatibleProvider({ id, apiKey, baseURL })`. Altrimenti crea `src/providers/<nome>.ts` che implementa `TextProvider` (o `ImageProvider` per le immagini): traduce `jsonSchema` nel formato del provider, normalizza `stopReason` e `usage`, e converte gli errori con `classifyError()` o `AiProviderError`.
2. Se serve un nuovo `ProviderId`, aggiungilo in `@forgecy/core` (`providerIds`) e nella migrazione dell'enum `ai_provider`.
3. Registralo in `createProvidersFromEnv` solo quando la sua configurazione esiste.
4. Aggiungi i prezzi in `pricing.ts`.
5. Test con `fetch` finto (vedi `test/adapters.test.ts`): niente rete nei test.
6. Prima di attivarlo come primario o fallback per un task, verifica i prompt sul set fisso di 10 brief di prova.

## Da verificare

- `providers/google-images.ts`: endpoint `generateContent`, ID modelli e forma della risposta (Google documenta anche `/v1beta/interactions`).
- Prezzi di immagini Google, modelli OpenRouter e modelli locali.
