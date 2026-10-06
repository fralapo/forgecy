# 0002 · Storage S3 opzionale con SeaweedFS invece di MinIO

- Stato: accettata (M1)
- Data: 2026-10-05

## Contesto

La scheda indica il disco locale come storage di default e MinIO come alternativa. MinIO Community Edition non pubblica più immagini Docker da ottobre 2025 e il repository è stato archiviato nel 2026.

## Decisione

Il default resta il disco (`STORAGE_DRIVER=local`, file in `./data/media`). Il driver `s3` di `packages/files` funziona con qualunque storage compatibile S3; il profilo Compose `s3` include SeaweedFS (Apache 2.0) per chi vuole uno storage a oggetti sulla stessa macchina.

## Conseguenze

Nessuna dipendenza a pagamento. Chi ha già un S3 compatibile (Garage, Ceph, un bucket esterno) imposta `S3_ENDPOINT` e le chiavi senza cambiare codice.
