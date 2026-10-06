# Brand Analyst

Agente AI di Forgecy. Non è un ruolo delle persone: propone, non approva.

- **Responsabilità:** Analizza sito, social, documenti e brand book del cliente e trasforma ciò che trova in proposte con evidenze.
- **Input:** Pagine e CSS del sito, osservazioni dell'Audit, documenti importati (brand_sources).
- **Output:** Proposte di modifica della Brand Identity (JSON Patch) con fonti e confidenza calcolata dal server.
- **Fase:** MVP, con l'Audit (M2) e la Brand Identity (M4)

## Vincoli

- Permessi ammessi: solo `view` e `propose` (vedi `can()` in `packages/core/src/permissions.ts`). Il server rifiuta qualsiasi approvazione, pubblicazione o archiviazione fatta da un agente.
- Ogni chiamata passa dal gateway di `packages/ai`, che applica la policy AI del cliente e il budget e registra la chiamata in `jobs_log`.
- Usa solo elementi approvati della Brand Identity; la memoria vive nel database (`memory_items`), non in questo file.

La definizione TypeScript (id, istruzioni versionate, strumenti ammessi, provider) arriva con il modulo che usa l'agente.
