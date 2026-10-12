# 0018 · Optional restore under a role without superuser rights

- Status: accepted
- Date: 2026-10-09

## Context

A restore (Settings › Backup and `pnpm forgecy restore`) runs the backup's `db.sql` through `psql -X --single-transaction -v ON_ERROR_STOP=1` as the `DATABASE_URL` role. In the official postgres image that role is the bootstrap superuser. The dump scanner (`packages/backup/src/safe-dump.ts`) refuses psql meta-commands, server-side `COPY`, `ALTER SYSTEM/ROLE/DATABASE` and other constructs, but it is a static allowlist: SQL that builds a command at run time (a `DO` block with `EXECUTE 'COPY ... TO PROGRAM ...'`) passes it. As a superuser, such a statement runs a shell command on the database server, reads or writes server files, changes server settings or creates roles. `docs/SECURITY_CHECKLIST.md` (sections 5 and 7) left "restore under a least-privilege role" open.

What a role needs to load a `pg_dump --clean --if-exists --no-owner` of this schema was tested on `pgvector/pgvector:pg17` (PostgreSQL 17, pgvector 0.8.7):

- `--clean` makes the dump drop every object before recreating it, and only an object's owner (or a member of the owner role) may drop it. Being a member of the superuser role is not an option: membership allows `SET ROLE` to it. So the restore role has to own the app's objects.
- Migrations run as `DATABASE_URL`, so every object they create belongs to the superuser. That includes objects a later upgrade adds, and the migrations the worker applies right after a restore.
- pgvector is not a trusted extension in this image (`vector.control` has no `trusted = true`). A role without superuser rights can neither `DROP EXTENSION vector`, `CREATE EXTENSION vector`, nor `COMMENT ON EXTENSION vector`, and the dump has one line for each. `CREATE EXTENSION IF NOT EXISTS` on an extension that exists is a no-op for anyone, but the `DROP` and the `COMMENT` fail ("must be owner of extension vector").
- The dump also runs `DROP SCHEMA IF EXISTS drizzle; CREATE SCHEMA drizzle;` (needs `CREATE` on the database and ownership of `drizzle`) and creates tables, types and two plpgsql trigger functions in `public` (needs `CREATE` on `public`, which PostgreSQL 15+ no longer grants to `PUBLIC`). plpgsql is trusted, so the functions need nothing more.

## Decision

A new optional variable, `FORGECY_RESTORE_DATABASE_URL`. Unset (the default), nothing changes. Set, both restore paths load the dump as that role:

- Validation (`restoreDatabaseUrl` in `packages/backup/src/restore-role.ts`, shared by the worker and the CLI): a `postgres://` or `postgresql://` URL whose user is a plain role name (letters, digits, `_`). The worker checks it when it starts; the CLI before it reads the archive. Errors never repeat the value (it holds a password), and the URL is redacted from tool errors as `DATABASE_URL` already was.
- Before each restore, the app runs fixed SQL as `DATABASE_URL` (`restoreOwnershipSql`; nothing in it comes from the backup). It refuses a role that is a superuser or has `CREATEDB`, `CREATEROLE`, `REPLICATION` or `BYPASSRLS`, then grants `CONNECT, CREATE` on the current database and `USAGE, CREATE` on `public`, and makes the role owner of the `drizzle` schema and of every table, view, sequence, enum, domain, range type and function in `public` and `drizzle`, except pgvector's own objects. Doing this every time, rather than once by hand, keeps restores working after upgrades whose migrations create objects as the superuser.
- In a restricted restore, the extension lines (`DROP EXTENSION IF EXISTS …;`, `CREATE EXTENSION IF NOT EXISTS … WITH SCHEMA …;`, `COMMENT ON EXTENSION … IS '…';`) are left out of the dump, only before its first `COPY` (table data is never touched), and before the scanner runs, so the scanner still reads exactly what psql receives. The extension stays as the migrations created it.
- The worker (`packages/backup/src/jobs.ts`) passes the URL to `psqlLoadInto` and `restoreArchive({ restricted: true })`; the pre-restore backup and the migrations after the restore keep using `DATABASE_URL`. The CLI (`scripts/lib/backup.ts`) does the same; with Compose running, psql runs inside the postgres container, where the service name `postgres` and `localhost` both reach the server.

The role is created once by whoever runs the installation (in Compose: `docker compose exec postgres psql -U forgecy -d forgecy`):

```sql
CREATE ROLE forgecy_restore LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
\password forgecy_restore
```

Then `FORGECY_RESTORE_DATABASE_URL=postgres://forgecy_restore:<password>@postgres:5432/forgecy` in `.env` (`localhost` instead of `postgres` for `pnpm dev`). Everything else (the grants and ownership above) is done by the restore itself. To do it by hand instead, run the SQL that `restoreOwnershipSql('forgecy_restore')` returns, as the superuser, after every upgrade.

## Consequences

- Proven by `packages/backup/test/restore-role.integration.test.ts` (runs with `FORGECY_TEST_DATABASE_URL` and `psql`/`pg_dump` 17+ on PATH, otherwise skipped): a real `pg_dump` of the migrated schema restored through `restoreArchive` as the restricted role into a scratch database, data and ownership checked, a second restore after a simulated upgrade, and the two failures that motivate the design (no ownership step: "must be owner"; extension lines kept: "must be owner of extension vector"). It also checks that `COPY ... TO PROGRAM` is refused by the scanner as a plain statement and by the role when hidden in `EXECUTE`, and that file `COPY` and `ALTER SYSTEM` are refused.
- What it protects against, while the dump loads: running programs (`COPY ... PROGRAM`), reading or writing server files (`COPY` to or from a file, `pg_read_file`, `lo_import`), `ALTER SYSTEM`, creating or altering roles, `SET ROLE` to another role, creating databases, untrusted languages (C) and untrusted extensions.
- What it does not protect against:
  - The role owns the app's data and can drop or replace all of it: that is what a restore does.
  - A hostile dump can create triggers, functions or column defaults that run later with the rights of whoever triggers them. The app connects as the `DATABASE_URL` superuser, so a trigger planted by a backup runs as superuser on the next write to that table (tested: a trigger on a table the role owns executed `ALTER ROLE … SUPERUSER` when the superuser inserted a row). Closing that needs the app itself to connect as a role without superuser rights, which is outside this decision. Restore only backups you made or trust; the restricted role narrows what a bad backup can do during the restore, it does not make one safe.
  - Like any role, it can connect to the server's other databases (PostgreSQL grants `CONNECT` to `PUBLIC` by default). It owns nothing there and, on PostgreSQL 15+, cannot create objects in their `public` schema. Revoke `CONNECT` from `PUBLIC` on those databases if that matters.
  - With `CREATE` on the database it can create trusted extensions and schemas of its own.
- Not enforced: an installation that never sets the variable restores as before. A dump that needs an extension the target database does not have fails in a restricted restore (rolled back, as any failed restore) and needs the superuser path.
- The ownership step changes owners in the live database even if the restore then fails. That is harmless: `DATABASE_URL` is a superuser and does not depend on owning anything.
