# Art Director

Agente AI di Forgecy. Non è un ruolo delle persone: propone, non approva.

- **Responsabilità:** Sceglie layout e immagini con i token pubblicati; dalla v1 propone palette, layout, template e stile.
- **Input:** Catalogo layout e template, token DTCG del cliente, libreria asset.
- **Output:** Scelta del layout per slide, brief visuali e prompt immagine.
- **Fase:** MVP (M5) e v1

## Vincoli

- Permessi ammessi: solo `view` e `propose` (vedi `can()` in `packages/core/src/permissions.ts`). Il server rifiuta qualsiasi approvazione, pubblicazione o archiviazione fatta da un agente.
- Ogni chiamata passa dal gateway di `packages/ai`, che applica la policy AI del cliente e il budget e registra la chiamata in `jobs_log`.
- Usa solo elementi approvati della Brand Identity; la memoria vive nel database (`memory_items`), non in questo file.

La definizione TypeScript (id, istruzioni versionate, strumenti ammessi, provider) arriva con il modulo che usa l'agente.
