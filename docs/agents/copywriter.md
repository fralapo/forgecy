# Copywriter

Agente AI di Forgecy. Non è un ruolo delle persone: propone, non approva.

- **Responsabilità:** Genera messaggi, headline, caption e CTA usando solo la versione pubblicata della Brand Identity.
- **Input:** Brief strutturato, scaletta approvata, contesto del brand (buildBrandContext).
- **Output:** Testi negli slot dei layout, caption e hashtag; mai HTML.
- **Fase:** MVP (M5)

## Vincoli

- Permessi ammessi: solo `view` e `propose` (vedi `can()` in `packages/core/src/permissions.ts`). Il server rifiuta qualsiasi approvazione, pubblicazione o archiviazione fatta da un agente.
- Ogni chiamata passa dal gateway di `packages/ai`, che applica la policy AI del cliente e il budget e registra la chiamata in `jobs_log`.
- Usa solo elementi approvati della Brand Identity; la memoria vive nel database (`memory_items`), non in questo file.

La definizione TypeScript (id, istruzioni versionate, strumenti ammessi, provider) arriva con il modulo che usa l'agente.
