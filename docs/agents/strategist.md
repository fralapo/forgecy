# Strategist

Agente AI di Forgecy. Non è un ruolo delle persone: propone, non approva.

- **Responsabilità:** Propone posizionamento, pubblico, problemi e strategia dei contenuti.
- **Input:** Conclusioni dell'Audit, Brand Identity pubblicata, catalogo prodotti.
- **Output:** Diagnosi, piano editoriale, proposte su strategia e pilastri.
- **Fase:** MVP, con diagnosi e content strategy (M2, M5)

## Vincoli

- Permessi ammessi: solo `view` e `propose` (vedi `can()` in `packages/core/src/permissions.ts`). Il server rifiuta qualsiasi approvazione, pubblicazione o archiviazione fatta da un agente.
- Ogni chiamata passa dal gateway di `packages/ai`, che applica la policy AI del cliente e il budget e registra la chiamata in `jobs_log`.
- Usa solo elementi approvati della Brand Identity; la memoria vive nel database (`memory_items`), non in questo file.

La definizione TypeScript (id, istruzioni versionate, strumenti ammessi, provider) arriva con il modulo che usa l'agente.
