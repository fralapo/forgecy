import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";

test("previous application remains available as a historical archive", () => {
  assert.ok(existsSync("old/README.md"));
  assert.ok(existsSync("old/apps/web"));
  assert.ok(existsSync("old/LICENSE"));
});

test("local-first runtime has no Supabase package or connection configuration", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const env = readFileSync(".env.example", "utf8");
  assert.ok(!Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).some(name => name.includes("supabase")));
  assert.ok(!env.toLowerCase().includes("supabase"));
  assert.ok(env.includes("OPENROUTER_API_KEY="));
  assert.ok(!env.includes("GOOGLE_DRIVE_CLIENT_ID="));
  assert.ok(!existsSync("lib/sync/drive.ts"));
  assert.ok(!existsSync("app/api/sync/google/route.ts"));
  const backupSettings = readFileSync("components/backup-settings.tsx", "utf8");
  assert.match(backupSettings, /Backup e trasferimento/);
  assert.doesNotMatch(backupSettings, /Collega Google Drive|Client ID Google/);
  assert.match(backupSettings, /client cloud installato/);
});

test("local storage and loopback worker are the active architecture", () => {
  const database = readFileSync("lib/local-db/index.ts", "utf8");
  const worker = readFileSync("lib/local-worker.ts", "utf8");
  const config = readFileSync("proxy.ts", "utf8");
  const access = readFileSync("lib/tailscale-access.ts", "utf8");
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(database, /forgecy\.sqlite/);
  assert.match(database, /journal_mode = WAL/i);
  assert.match(worker, /processNextJob/);
  assert.match(access, /localhost.*127\.0\.0\.1/);
  assert.match(manifest.scripts["start:tailscale"], /--hostname 127\.0\.0\.1/);
  assert.match(manifest.scripts["start:tailscale"], /--port 7694/);
  assert.match(manifest.scripts["dev:tailscale"], /--port 7694/);
  assert.match(config, /FORGECY_TAILSCALE_ALLOWED_USER/);
});
