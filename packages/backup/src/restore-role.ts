/**
 * Optional restore under a role with fewer privileges (ADR 0018). When
 * FORGECY_RESTORE_DATABASE_URL is set, psql loads the dump as that role instead of the
 * DATABASE_URL one. No workspace imports: the ops CLI (scripts/lib/backup.ts) uses this file too.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { rename } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

/** Role names the ownership SQL below can embed without quoting surprises. */
const ROLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The URL psql restores with: `value` when set, otherwise undefined (restore as DATABASE_URL).
 * Errors never repeat the value: it carries a password.
 */
export function restoreDatabaseUrl(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("FORGECY_RESTORE_DATABASE_URL is not a valid URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
    throw new Error("FORGECY_RESTORE_DATABASE_URL must start with postgres://");
  if (!ROLE_NAME.test(decodeURIComponent(url.username)))
    throw new Error(
      "FORGECY_RESTORE_DATABASE_URL must name its role (letters, digits and _ only), as in postgres://forgecy_restore:password@host:5432/forgecy",
    );
  return raw;
}

/** The role a restore URL logs in as (validated by restoreDatabaseUrl). */
export function restoreRoleName(url: string): string {
  return decodeURIComponent(new URL(url).username);
}

/**
 * Run as the DATABASE_URL role (the superuser) right before a restricted restore. A restore
 * drops and recreates every object of the dump, and only an object's owner may drop it, so the
 * restore role is given ownership of the app's schemas and objects, including those created
 * since the last restore by migrations, which run as DATABASE_URL. Fixed SQL: nothing in it
 * comes from the backup. Refuses a restore role that would make the restriction pointless.
 */
export function restoreOwnershipSql(role: string): string {
  if (!ROLE_NAME.test(role)) throw new Error("Invalid restore role name");
  return `DO $forgecy$
DECLARE
  r text := '${role}';
  o record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
    RAISE EXCEPTION 'The role in FORGECY_RESTORE_DATABASE_URL does not exist (ADR 0018)';
  END IF;
  IF (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls
      FROM pg_roles WHERE rolname = r) THEN
    RAISE EXCEPTION 'The role in FORGECY_RESTORE_DATABASE_URL must be NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS (ADR 0018)';
  END IF;
  EXECUTE format('GRANT CONNECT, CREATE ON DATABASE %I TO %I', current_database(), r);
  EXECUTE format('GRANT USAGE, CREATE ON SCHEMA public TO %I', r);
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'drizzle') THEN
    EXECUTE format('ALTER SCHEMA drizzle OWNER TO %I', r);
  END IF;
  -- Tables (their indexes, constraints and owned sequences follow), views, free sequences.
  FOR o IN SELECT c.oid::regclass AS name, c.relkind FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'drizzle') AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass
          AND d.objid = c.oid AND d.deptype IN ('e', 'a', 'i')) LOOP
    EXECUTE format('ALTER %s %s OWNER TO %I', CASE o.relkind WHEN 'S' THEN 'SEQUENCE'
      WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE'
      ELSE 'TABLE' END, o.name, r);
  END LOOP;
  -- Enums, domains, ranges; extension members (pgvector's) stay with the extension.
  FOR o IN SELECT t.oid::regtype AS name, t.typtype FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname IN ('public', 'drizzle') AND t.typtype IN ('e', 'd', 'r')
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass
          AND d.objid = t.oid AND d.deptype = 'e') LOOP
    EXECUTE format('ALTER %s %s OWNER TO %I',
      CASE o.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END, o.name, r);
  END LOOP;
  FOR o IN SELECT p.oid::regprocedure AS name FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public', 'drizzle')
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass
          AND d.objid = p.oid AND d.deptype = 'e') LOOP
    EXECUTE format('ALTER ROUTINE %s OWNER TO %I', o.name, r);
  END LOOP;
END
$forgecy$;
`;
}

/**
 * pg_dump lines that drop, create or comment an extension. Only a superuser can do that for
 * pgvector (not a trusted extension), so a restricted restore leaves them out: the extension
 * stays as the migrations created it. Matched only before the first COPY (table data).
 */
const EXTENSION_LINE =
  /^(?:DROP EXTENSION IF EXISTS [\w"]+;|CREATE EXTENSION IF NOT EXISTS [\w"]+ WITH SCHEMA [\w"]+;|COMMENT ON EXTENSION [\w"]+ IS '(?:[^']|'')*';)\r?$/;

function extensionLineFilter(): (line: string) => boolean {
  let data = false;
  return (line) => {
    if (line.startsWith("COPY ")) data = true;
    return data || !EXTENSION_LINE.test(line);
  };
}

/** The dump without its extension statements (line endings kept as they are). */
export function withoutExtensionStatements(sql: string): string {
  return sql.split("\n").filter(extensionLineFilter()).join("\n");
}

/** Same as withoutExtensionStatements, rewriting a dump file in place without loading it whole. */
export async function stripExtensionStatements(file: string): Promise<void> {
  const keep = extensionLineFilter();
  const out = `${file}.restricted`;
  let rest = "";
  let data = false;
  await pipeline(
    createReadStream(file, "utf8"),
    async function* (chunks: AsyncIterable<string>) {
      for await (const chunk of chunks) {
        if (data) {
          yield chunk;
          continue;
        }
        const lines = (rest + chunk).split("\n");
        rest = lines.pop() ?? "";
        const kept = lines.filter(keep);
        if (kept.length) yield `${kept.join("\n")}\n`;
        data = lines.some((l) => l.startsWith("COPY "));
        if (data) {
          yield rest;
          rest = "";
        }
      }
      if (!data && keep(rest)) yield rest;
    },
    createWriteStream(out),
  );
  await rename(out, file);
}
