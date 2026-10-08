# Pre-go-live security checklist

Run through this before putting a Forgecy install in front of a client or
prospect. It is not an exhaustive pentest: it is the short list of checks
tied to the attack surfaces this tool actually has (it fetches URLs a user
gives it, it imports files a user gives it, and it can restore a full
backup over the running install).

## 1. Malicious URL and redirect tests (crawler: Prospect audits, Brand Identity website source)

The crawler guard (`packages/core/src/net-guard.ts`, re-exported by
`packages/audit/src/url.ts` and used by both `packages/audit` and
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
- [ ] Submit `http://[::ffff:a9fe:a9fe]/`, `http://[64:ff9b::a9fe:a9fe]/` and
      `http://[2002:a9fe:a9fe::1]/` (hex-mapped, NAT64 and 6to4 forms of the
      metadata address). Each must be refused like the dotted forms above.
- [ ] Serve a page whose script runs `fetch("http://192.168.1.1/")` and an
      `<img src="http://169.254.169.254/">`. Neither request may leave the
      machine (the browser logs `blockedbyclient`); a `Sitemap:` line pointing
      at another host or a private address must not be fetched.
- [ ] In the same page open `new WebSocket("ws://127.0.0.1:3001/")`. The socket
      must be closed by the crawler's WebSocket gate, never reach the service.
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
- [ ] Upload a DOCX/XLSX whose central directory understates an entry's size,
      a DOCX/PPTX/XLSX with more entries than the cap or one part over the
      part cap, and a PDF with thousands of pages: each is refused with a
      clear message (damaged, too large), not a timeout or an out-of-memory
      crash. All Office readers go through the guarded reader in
      `packages/files/src/safe-zip.ts` and count real inflated bytes, not
      the sizes the archive declares. Limits: catalog import 50 MB per XML
      part and in total, 5 000 entries; brand import 50 MiB per part, 100 MiB
      in total, 10 000 entries; social xlsx upload 20 MB and 5 000 entries.
      PDFs: the brand importer reads the first 400 pages and refuses a PDF
      above 2 000; the catalog importer refuses a PDF above 500 pages.
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

## 4. Sign-in and first run (see `docs/adr/0014-auth-hardening.md`)

- [ ] Send six wrong passwords for one username to `/api/auth/sign-in/email`;
      the sixth must return 429 with a `Retry-After` header, and a username
      that does not exist must behave the same way.
- [ ] With `FORGECY_SETUP_TOKEN` set on a fresh database, `/setup` asks for the
      token and refuses a wrong one.
- [ ] Open `/login?next=/\evil.com` and `/login?next=//evil.com`; after signing
      in, both must land on `/`.
- [ ] `curl -sI` on `/login` shows `Content-Security-Policy`, `X-Frame-Options`,
      `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy`;
      `/render/*` and `/api/files/*` do not get a second policy.
- [ ] Behind https, `Strict-Transport-Security` is present (emitted by Caddy,
      not by the Next.js image). Browsers remember it for the hostname for a year,
      including other ports of the same host (such as `:3000` over http).
- [ ] Open the signed URL of an SVG that contains a `<script>` as a top-level
      page; the script must not run.
- [ ] After changing a password, a second signed-in browser is signed out.

## 5. Hostile restore and client import (see `docs/adr/0015-client-import-trust-reset.md`)

A backup and a client package are both files someone else may have written.
Restore only backups you made or trust: the role in `DATABASE_URL` is a
superuser in the official postgres image, so the dump scanner is a barrier,
not a sandbox. Running the restore under a least-privilege role is a
recommended follow-up, not built yet.

### Backup restore (Backup and restore in Settings, `pnpm forgecy restore`)

- [ ] Upload a `.tar.gz` that holds a symlink, a hard link or a device entry:
      the upload is refused and nothing is kept (no `.partial` file, no
      extracted folder).
- [ ] Put `\! touch /tmp/forgecy-pwned` on its own line in `db.sql` inside an
      otherwise valid backup, repack it, and restore it: the restore fails
      before psql starts with an unsafe-dump message, the file is not
      created, the database is unchanged. Repeat with a `\copy` line and
      with a bare `BEGIN;`: both are refused too (the scanner in
      `packages/backup/src/safe-dump.ts` is an allowlist: only pg_dump's own
      `SET` lines, no `E'...'` strings, no bare `BEGIN`). How to run it: the
      checksum is verified before the scanner, so a repacked archive restored
      from a local path fails with a checksum error and the drill has not
      run. Either upload the repacked file in Backup and restore (the upload
      writes a fresh sidecar) and restore it from there, or delete the
      sidecar `<archive>.json` next to it. A checksum error means the drill
      was run incorrectly, not that it passed.
- [ ] False refusals fail closed, and the scanner was not validated against a
      real pg_dump on the Windows dev host. On a populated install take a
      backup (`pnpm forgecy backup`), restore it onto an empty database and
      confirm it restores. If a genuine backup is refused as an unsafe dump,
      treat it as a bug in the scanner and report the offending line; do not
      edit the dump to get past it.
- [ ] Restore a backup whose sidecar `.json` checksum was edited: refused
      (`restoreArchive` verifies it itself, not only `inspectBackup`). A
      sidecar that is unreadable or has no `sha256` is refused as well; only
      a missing sidecar passes.
- [ ] Legacy sidecars written between PRs #38 and #82 have no `sha256` and
      now block restore, from the UI and from `pnpm forgecy restore` alike
      (both call the same checksum check against `<archive>.json`). The only
      workaround is to delete that sidecar, and only for a file you trust,
      since it drops the checksum check.
- [ ] Append a statement that fails (for example
      `ALTER TABLE no_such_table ADD COLUMN x int;`) to the end of the
      `db.sql` of an otherwise valid backup and restore it (same route as the
      `\!` drill above: upload it, or delete the sidecar): psql runs with
      `-X --single-transaction -v ON_ERROR_STOP=1`, so the restore stops at
      the error and the database is exactly as it was before, not half
      loaded.

### Client import (Import/export in Settings)

- [ ] Import a package whose `contents.client_id` is another client's id and
      one whose `assets.storage_key` names `clients/<other id>/...` (also
      with the id written with JSON `\u` escapes): both are refused at Verify
      ("unsafe") and nothing is written.
- [ ] Edit one stored file in a valid package so its bytes no longer match
      its checksum: the import fails, no client row and no stored file are
      left behind.
- [ ] Import a zip bomb (a small package that inflates far beyond the
      package bound), a package with more than 200 000 entries or a JSON file
      over 64 MiB: each is refused at Verify with a clear message. Limits:
      200 000 entries, 64 MiB of JSON per entry, 256 MiB of JSON per package, and a total
      bound of min(20 GiB, max(1 GiB, 200 x the archive's size)).
- [ ] Import a package that holds only some areas (for example brand data
      whose examples point at carousel versions): refused as
      `incompleteArea`; export again with the missing area to import it.
- [ ] Import a package where a carousel has `status: "approved"`, then check
      the new client. Content arrives as Draft with no approvals, exports
      or Brand Guard runs. Templates arrive as Drafts owned by the client.
      Brand Identity versions arrive archived (restore one as a new draft).
      Automations arrive paused. The AI policy is never looser than the
      installation default for a new client and the approved AI providers
      list is empty. Products that were approved arrive as proposed. Images
      that were labelled `product` arrive as `upload` with rights pending.
- [ ] Import the same package twice (or a package whose template version
      already exists here): both imports succeed, the second one's template
      is renamed `X.Y.Z-import.N`, and no carousel, preview or export picks
      up another client's template.

## Sign-off

Record the date, the person who ran it, and which of the five sections
passed in the PR or ticket that references this checklist. A failing item
blocks go-live until fixed or explicitly accepted as a known limitation
(e.g. the documented residual gap: a crawl redirect to a _different_
domain mid-crawl still relies on `crawlSite`'s own per-navigation check
rather than a second DNS pin, since Chromium is only pinned for the
crawl's starting host).
