# Reviewer

Agente AI di Forgecy. Non è un ruolo delle persone: propone, non approva.

- **Responsabilità:** Controlla coerenza, errori, contrasto e regole; può bloccare un export, non cambiare le regole.
- **Input:** Documento delle slide, render, regole di Brand Guard.
- **Output:** Esito del brand check con avvisi ed errori.
- **Fase:** MVP a regole (M6), v1 con modello

## Vincoli

- Permessi ammessi: solo `view` e `propose` (vedi `can()` in `packages/core/src/permissions.ts`). Il server rifiuta qualsiasi approvazione, pubblicazione o archiviazione fatta da un agente.
- Ogni chiamata passa dal gateway di `packages/ai`, che applica la policy AI del cliente e il budget e registra la chiamata in `jobs_log`.
- Usa solo elementi approvati della Brand Identity; la memoria vive nel database (`memory_items`), non in questo file.

La definizione TypeScript (id, istruzioni versionate, strumenti ammessi, provider) arriva con il modulo che usa l'agente.
