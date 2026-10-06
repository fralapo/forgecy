# @forgecy/files

Storage privato dei file (asset, font, export) con due driver intercambiabili.

- `LocalDiskDriver`: file sotto `MEDIA_ROOT`; gli URL firmati puntano a `${FORGECY_BASE_URL}/api/files/<key>?exp=..&sig=..` (HMAC-SHA256). La route web verifica con `verifySignedFileUrl(key, exp, sig, fileSigningSecretFromEnv(env), { disposition, filename })` e poi fa lo stream con `driver.get(key)`.
- `S3Driver`: MinIO o qualsiasi S3 compatibile (`forcePathStyle` attivo quando c'è `S3_ENDPOINT`); URL GET/PUT prefirmati con l'SDK AWS v3.
- `createStorageFromEnv(env)` sceglie il driver da `STORAGE_DRIVER`.

I file non sono mai pubblici: si servono solo con URL firmati a scadenza breve.

Upload: `validateUpload({ kind, mime, size, firstBytes })` controlla i magic byte e il tipo dichiarato. Limiti: immagini 20 MB (PNG, JPEG, WebP, GIF; SVG solo con `allowSvg`), font 10 MB (solo TTF, OTF, WOFF2), documenti 50 MB (PDF, XLSX, CSV, TXT, MD, JSON).

Chiavi: `contentKey({ clientId, scope, sha256, ext })` → `clients/<id>/<scope>/<sha>.<ext>`; `sha256()` / `sha256Stream()` per l'hash.

Test: `pnpm test`. Il test S3 parte solo con `FORGECY_TEST_S3_ENDPOINT` (es. `http://localhost:9000`, credenziali `FORGECY_TEST_S3_ACCESS_KEY_ID`/`_SECRET_ACCESS_KEY`, default `minioadmin`).
