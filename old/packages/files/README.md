# @forgecy/files

Private file storage (assets, fonts, exports) with two interchangeable drivers.

- `LocalDiskDriver`: files under `MEDIA_ROOT`; signed URLs point to `${FORGECY_BASE_URL}/api/files/<key>?exp=..&sig=..` (HMAC-SHA256). The web route verifies with `verifySignedFileUrl(key, exp, sig, fileSigningSecretFromEnv(env), { disposition, filename })` and then streams with `driver.get(key)`.
- `S3Driver`: MinIO or any S3-compatible storage (`forcePathStyle` on when `S3_ENDPOINT` is set); presigned GET/PUT URLs with the AWS SDK v3.
- `createStorageFromEnv(env)` picks the driver from `STORAGE_DRIVER`.

Files are never public: they are served only with short-lived signed URLs.

Uploads: `validateUpload({ kind, mime, size, firstBytes })` checks the magic bytes and the declared type. Limits: images 20 MB (PNG, JPEG, WebP, GIF; SVG only with `allowSvg`), fonts 10 MB (TTF, OTF, WOFF2 only), documents 50 MB (PDF, XLSX, CSV, TXT, MD, JSON).

Keys: `contentKey({ clientId, scope, sha256, ext })` → `clients/<id>/<scope>/<sha>.<ext>`; `sha256()` / `sha256Stream()` for hashing.

Tests: `pnpm test`. The S3 test runs only with `FORGECY_TEST_S3_ENDPOINT` (e.g. `http://localhost:9000`, credentials `FORGECY_TEST_S3_ACCESS_KEY_ID`/`_SECRET_ACCESS_KEY`, default `minioadmin`).
