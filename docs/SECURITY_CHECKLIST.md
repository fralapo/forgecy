# Pre-go-live security checklist

Run through this before putting a Forgecy install in front of a client or
prospect. It is not an exhaustive pentest: it is the short list of checks
tied to the attack surfaces this tool actually has (it fetches URLs a user
gives it, it imports files a user gives it, and it can restore a full
backup over the running install).

## 1. Malicious URL and redirect tests (crawler: Prospect audits, Brand Identity website source)

The crawler (`packages/audit/src/url.ts`, used by both `packages/audit` and
`packages/brand`) refuses to fetch a private or loopback address, and pins
DNS resolution to the address it validated so a rebinding name server
cannot swap in a private address between the check and the real
connection (`createPinnedFetch`, `resolvePinnedAddress`). Before go-live,
confirm by hand against a real target, not just the unit tests in
`packages/audit/test/ssrf-rebinding.test.ts`:

- [ ] Submit `http://127.0.0.1/`, `http://localhost/`, `http://[::1]/`, and a
      `169.254.169.254` (cloud metadata) URL as an audit/brand source. Each
      must fail with "address is local or private", not hang or succeed.
- [ ] Submit a URL that 302-redirects to one of the addresses above. The
      redirect must be refused on the hop that resolves to it, not followed.
- [ ] Point a domain you control at a short-TTL DNS record, start a scan,
      then repoint the record to `127.0.0.1` before the scan's second
      request. The scan must still fail safely (this is what the pinned
      fetch and Chromium `--host-resolver-rules` pinning exist for).
- [ ] With `FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS=true` set (intranet use),
      confirm the same requests now succeed — the escape hatch is explicit
      and off by default.

## 2. Hostile archive tests (catalog import: ZIP/folder uploads)

- [ ] Upload a ZIP containing a path-traversal entry (`../../etc/passwd`,
      an absolute path, or a Windows drive path) and confirm the import
      rejects or sanitizes the entry instead of writing outside the job's
      storage prefix.
- [ ] Upload a zip bomb (a small archive that decompresses to many GB) and
      confirm the import's size/file-count limits stop it rather than
      exhausting disk or memory.
- [ ] Upload a PDF or image with a corrupted header and confirm the
      pipeline records a warning for that file and continues, instead of
      crashing the import job.
- [ ] With Catalog AI left at its default (off, Settings > AI policies),
      confirm PDF text extraction and AI image matching are skipped with
      the "not enabled on this installation" message, and that manual
      entry, CSV/XLSX, and ZIP/folder name-and-SKU matching still work.

## 3. Off-host restore drill (`pnpm forgecy backup` / `restore`)

- [ ] Take a backup on the live install (`pnpm forgecy backup`).
- [ ] Copy the archive to a second, unrelated machine or container with a
      fresh Forgecy checkout and an empty database.
- [ ] Restore it there (`pnpm forgecy restore <name>`) and confirm:
  - the checksum in the backup's sidecar is verified before anything is
    written (`inspectBackup` in `packages/backup/src/restore.ts` reports
    `checksum_mismatch` if you corrupt one byte of the archive first —
    try this deliberately);
  - a backup with a newer "last migration" than the restoring version is
    refused (`newer_version`) instead of partially applying;
  - after a clean restore, `pnpm forgecy health` reports healthy and the
    client/prospect data matches the source install.
- [ ] Repeat with a backup that was uploaded through
      `apps/web/app/api/system/backups/upload/route.ts` rather than taken
      locally, to confirm the upload path enforces the same checks.

## Sign-off

Record the date, the person who ran it, and which of the three sections
passed in the PR or ticket that references this checklist. A failing item
blocks go-live until fixed or explicitly accepted as a known limitation
(e.g. the documented residual gap: a crawl redirect to a _different_
domain mid-crawl still relies on `crawlSite`'s own per-navigation check
rather than a second DNS pin, since Chromium is only pinned for the
crawl's starting host).
