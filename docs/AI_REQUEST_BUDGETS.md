# Forgecy V24 — budget condivisi per chiamate AI

## Perché

La coda AI preesistente limita il numero di job per cliente, ma non impediva
chiamate ripetute a OpenRouter dalla chat sincrona, dagli adattamenti LinkedIn
o richieste multiple al generatore di immagini. Un contatore JS in memoria
sarebbe aggirabile con più istanze Next.js.

**Questo modulo non è un limite monetario.** Il costo vero cambia con modello,
token, cache, chiamate alla generazione immagini e prezzi dei provider. Le
prenotazioni limitano frequenza e consumo di un budget *ponderato* per utente,
NON registrano USD/EUR spesi.

## Quote iniziali preconfigurate

| Operazione | 15 minuti per cliente | 24 ore per cliente | Unità quota workspace |
|---|---:|---:|---:|
| Chat Leader | 20 | 90 | 2 |
| Adattamento LinkedIn | 6 | 24 | 4 |
| Dossier | 3 | 12 | 7 |
| Strategia | 3 | 12 | 7 |
| Missione AI | 3 | 10 | 10 |
| Immagine AI | 3 | 12 | 12 |

**Per proprietario**: massimo **240 unità ponderate** nelle ultime 24 ore,
sommando *tutti* i clienti. Queste sono soglie tecniche modificabili con una
migrazione revisionata; non sono prezzi, crediti acquistabili o una garanzia di
spesa massima. Un singolo job multi-agente può generare più richieste al provider.

La prenotazione è registrata **prima** dell'invocazione del provider, e non è
rimborsata se la generazione fallisce: non deve diventare possibile aggirare le
quote ripetendo richieste fallite. Gli eventi scaduti non contano nei limiti
mobili; un job può venire bloccato perché il proprietario ha già usato il suo
budget con altri clienti.

## Sicurezza e attivazione

1. Dopo le migrazioni 0001–0015, applicare **`0016_ai_request_budgets.sql`**.
   **Distribuire la migrazione prima del codice**, perché senza la funzione
   PostgreSQL ogni richiesta AI diretta ora fallisce in modo sicuro con HTTP 503.
2. La tabella `public.ai_request_reservations` non ha policy RLS aperte e non
   concede SELECT/INSERT/UPDATE/DELETE ai ruoli autenticati. Tutte le scritture
   passano per `forgecy_reserve_ai_request`, con autorizzazione
   `auth.uid() == clients.owner_id`.
3. La funzione `SECURITY DEFINER` usa `search_path=''`, oggetti con schema
   qualificato, advisory lock transazionale sul proprietario e controllo
   atomico del numero di richieste/quote prima dell'inserimento.
4. Anche `forgecy_enqueue_ai_job` è protetta a livello SQL per impedire bypass
   delle quote da Supabase REST/RPC. La coda continua a far rispettare i
   precedenti limiti di job.
5. Se la quota è esaurita la funzione restituisce SQLSTATE `P0429`, mappato
   dalle API Next.js a HTTP 429. Errori DB o risposte vuote bloccano
   l'operazione con 503, senza invocare il modello.
6. Le richieste CLI/autenticate con token sessione sono soggette allo stesso
   controllo. Gli ID dei singoli eventi non vengono mostrati nel client.

## Cosa viene protetto

- `POST /api/workspace/clients/:id/messages` — routing/risposta del Leader.
- `POST /api/workspace/clients/:id/dossier/draft` — analisi diretta.
- `POST /api/workspace/clients/:id/missions` — missione sincrona.
- `POST /api/workspace/clients/:id/contents/:id/adapt` — adattamento AI.
- `POST /api/workspace/clients/:id/contents/:id/image` — generazione immagini.
- `forgecy_enqueue_ai_job` — dossier, strategia e missione asincroni,
  compresi i client che invocano direttamente la RPC Supabase.

## Verifiche e limiti residui

La CI esegue test TypeScript e PostgreSQL: RLS negata, client di un altro
proprietario, limite del quarto d'ora, limite delle 24 ore, budget ponderato
cross-client e chiamate dirette all'RPC della coda. Va ancora fatto un collaudo
in un ambiente di test con **due processi worker/app concorrenti**.

Per un vero *hard budget in USD* servono ulteriori passi:
- registrare gli ID e i dati di utilizzo fatturabile che il provider restituisce;
- contabilizzare la generazione immagini e ogni chiamata multi-agent;
- prenotare un massimale monetario *prima* della richiesta ed eseguire una
  riconciliazione corretta dopo la risposta, considerando anche errori e
  richieste interrotte; se il provider non impone un hard cap, nessuna
  stima preventiva può garantire costo esattamente massimo;
- mostrare dashboard e alert, permettere impostazioni per cliente e
  definire conservazione/pulizia degli eventi di quota (ad esempio
  dopo 30–90 giorni) e policy privacy.

Le quote correnti non limitano il costo di operazioni di sola esportazione,
né costituiscono una garanzia contro l'abuso di tutte le API non-AI. Per i
provider servono anche rate limit al proxy/WAF e monitoraggio di spesa.

Fonti: Supabase Database Functions / RLS e OpenRouter response usage
(vedi documentazione ufficiale).
