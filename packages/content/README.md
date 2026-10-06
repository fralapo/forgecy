# @forgecy/content

Contenuti e caroselli (M5): Content Strategy, piano a 30 giorni, caroselli con brief, scaletta, slide, immagini, revisione ed export.

- **Strategia** (`strategy.ts`): pilastri e rubriche con obiettivo, funnel, frequenza e prodotti collegati; revisione con `rev` (`CONFLICT-DRAFT-REV`). Il Planner (`content.propose_strategy`) salva solo proposte con fonti e confidenza; le accetta o rifiuta una persona.
- **Piano** (`content.propose_plan`): un piano proposto per volta; le voci si decidono una a una e «Attiva piano» sostituisce il piano attivo. Da una voce accettata nasce un carosello già impostato.
- **Caroselli** (`carousels.ts`): servono una Brand Identity pubblicata (`BRAND-NOT-PUBLISHED`) e un template pubblicato del catalogo. Il brief strutturato si adatta al canale (Instagram 2.200 caratteri di didascalia, LinkedIn 3.000). Scaletta (`content.generate_outline`), approvazione della scaletta, slide (`content.generate_slides`) validate contro i layout del template, modifica di una slide con un'istruzione (`content.edit_slide`) con «Tieni» o «Annulla modifica», slot protetti dall'AI.
- **Versioni**: ogni generazione, salvataggio, ripristino e invio crea una versione immutabile (trigger `content_versions_immutable`); la bozza si salva con `draftRev`.
- **Controlli** (`checks.ts`, anche nel browser): limiti del template, didascalia, CTA finale, hashtag, parole vietate, prezzi non richiesti, immagini AI non approvate, uso commerciale da verificare, alt text, prodotto o Brand Identity cambiati.
- **Revisione**: «Invia in revisione» richiede zero errori; l'approvazione richiede «Ho visto» su ogni avviso e una nota se approvi un tuo lavoro. Gli agenti propongono, non approvano mai.
- **Brand Guard** (`brand-guard.ts`): porta registrata dalle app con `setBrandGuard({ run: runBrandCheck, get: getBrandCheck, confirmForApproval: confirmBrandCheckForApproval })`. Con la porta registrata il carosello si controlla al salvataggio e all'invio, e l'approvazione conferma i suoi esiti nella stessa transazione. L'interfaccia mostra la fascia di coerenza e gli esiti, mai il punteggio numerico.
- **Immagini** (`assets.ts`, `content.generate_image`): libreria del cliente con indirizzi per contenuto (`clients/<id>/assets/<sha256>.<ext>`). Le immagini AI passano dal gateway (OpenAI, poi Gemini) e restano bozze finché una persona non le approva; un provider con `commercial_use_status` respinto è escluso, uno da verificare genera un avviso.
- **Export** (`content.export`, coda `export`): usa l'export del renderer con la versione approvata, il tema dal brand e la versione del template fissata; il primo export finale porta il carosello in «Esportato».
- **Prodotti** (`products.ts`): porta `setProductSource` per il catalogo. `listProductUsage(db, clientId, productId)` elenca pilastri, rubriche, voci di piano e caroselli che usano un prodotto (la sezione «Usato in» del catalogo).

Il worker registra `contentHandlers` da `@forgecy/content/handlers`; il browser importa solo `@forgecy/content/client`.

Test: `pnpm --filter @forgecy/content test`; quelli d'integrazione partono con `FORGECY_TEST_DATABASE_URL`.
