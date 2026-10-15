import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { zipSync } from "fflate";

test("local database persists records, preserves invariants, searches evidence, queues work and snapshots", async () => {
  const directory = mkdtempSync(join(tmpdir(), "forgecy-local-db-"));
  process.env.FORGECY_DATA_DIR = directory;
  const { localDb, LOCAL_OWNER_ID } = await import("../../lib/local-db/index");
  const db = localDb();
  try {
    assert.equal(db.connection.pragma("foreign_keys", { simple: true }), 1);
    assert.equal(db.connection.pragma("journal_mode", { simple: true }), "wal");
    assert.equal(db.connection.pragma("user_version", { simple: true }), 2);
    assert.equal((db.connection.pragma("table_info(social_accounts)") as { name: string }[]).some(column => column.name === "needs_reauth"), true);
    const created = await db.from("clients").insert({ owner_id: LOCAL_OWNER_ID, name: "Studio", industry: "Design", profile: { tone: "preciso" } }).select().single();
    assert.equal(created.error, null);
    assert.equal(created.data.profile.tone, "preciso");
    const clientId = created.data.id as string;
    assert.equal(created.data.knowledge_revision, 0);

    const source = await db.from("sources").insert({ client_id: clientId, kind: "note", title: "Mercato", body: "Il progetto Forgecy aiuta i clienti con strategia editoriale e contenuti", status: "ready" }).select().single();
    assert.equal(source.error, null);
    assert.equal((db.connection.prepare("SELECT knowledge_revision FROM clients WHERE id=?").get(clientId) as { knowledge_revision: number }).knowledge_revision, 1);
    const search = await db.rpc("forgecy_search_sources", { p_client_id: clientId, p_query: "strategia OR editoriale", p_limit: 5 });
    assert.equal(search.error, null);
    assert.equal(search.data[0].id, source.data.id);

    const changed = await db.from("clients").update({ name: "Studio aggiornato" }).eq("id", clientId).select().single();
    assert.equal(changed.error, null);
    assert.equal(changed.data.knowledge_revision, 2);
    const reservation = await db.rpc("forgecy_enqueue_ai_job", { p_client_id: clientId, p_kind: "dossier", p_payload: {} });
    assert.equal(reservation.error, null);
    const additionalJobs = await Promise.all(Array.from({ length: 25 }, () =>
      db.rpc("forgecy_enqueue_ai_job", { p_client_id: clientId, p_kind: "dossier", p_payload: {} })
    ));
    assert.equal(additionalJobs.every(job => job.error === null && typeof job.data === "string"), true);
    const claimed = await db.rpc("forgecy_claim_ai_job");
    assert.equal(claimed.error, null);
    assert.equal(claimed.data[0].id, reservation.data);
    assert.equal(claimed.data[0].status, "running");

    const snapshot = join(directory, "snapshot.sqlite");
    await db.snapshot(snapshot);
    const copy = new (await import("better-sqlite3")).default(snapshot, { readonly: true });
    assert.equal(copy.pragma("integrity_check", { simple: true }), "ok");
    assert.equal((copy.prepare("SELECT count(*) n FROM sources").get() as { n: number }).n, 1);
    copy.close();

    const uploaded = await db.storage.from("forgecy-assets").upload(`${clientId}/sample.png`, Buffer.from("png"), { upsert: false });
    assert.equal(uploaded.error, null);
    const downloaded = await db.storage.from("forgecy-assets").download(`${clientId}/sample.png`);
    assert.equal(Buffer.from(await downloaded.data!.arrayBuffer()).toString(), "png");

    await db.from("social_accounts").insert({ client_id: clientId, platform: "instagram", remote_id: "meta-account", username: "forgecy", token_ciphertext: "encrypted-secret" });
    const { archive, manifest } = await (await import("../../lib/sync/archive")).createWorkspaceArchive({ parentHash: "" });
    const { validateWorkspaceArchive, restoreWorkspaceArchive } = await import("../../lib/sync/archive");
    const unchangedArchive = await (await import("../../lib/sync/archive")).createWorkspaceArchive({ parentHash: "" });
    assert.equal(unchangedArchive.manifest.contentHash, manifest.contentHash);
    assert.notEqual(unchangedArchive.manifest.hash, manifest.hash);
    const validated = validateWorkspaceArchive(archive);
    assert.equal(validated.manifest.hash, manifest.hash);
    assert.equal(Buffer.from(validated.entries[`files/forgecy-assets/${clientId}/sample.png`]).toString(), "png");
    const scrubbedDbPath = join(directory, "scrubbed.sqlite");
    const scrubbedBytes = Buffer.from(validated.entries["database/forgecy.sqlite"]);
    writeFileSync(scrubbedDbPath, scrubbedBytes);
    const scrubbed = new (await import("better-sqlite3")).default(scrubbedDbPath, { readonly: true });
    assert.equal((scrubbed.prepare("SELECT token_ciphertext FROM social_accounts WHERE remote_id='meta-account'").get() as { token_ciphertext: string }).token_ciphertext, "");
    assert.equal((scrubbed.prepare("SELECT needs_reauth FROM social_accounts WHERE remote_id='meta-account'").get() as { needs_reauth: number }).needs_reauth, 1);
    scrubbed.close();
    assert.throws(() => validateWorkspaceArchive(zipSync({ "../escape": Buffer.from("bad") })), /percorso ZIP/i);
    await restoreWorkspaceArchive(archive);
    const restored = localDb();
    const afterRestore = await restored.from("clients").select("id,name").eq("id", clientId).single();
    assert.equal(afterRestore.data.name, "Studio aggiornato");
    const restoredFile = await restored.storage.from("forgecy-assets").download(`${clientId}/sample.png`);
    assert.equal(Buffer.from(await restoredFile.data!.arrayBuffer()).toString(), "png");

    const invalid = await db.from("campaigns").insert({ client_id: clientId, offer_id: "missing", title: "Bad", objective: "Bad", period: "30 giorni" }).select().single();
    assert.ok(invalid.error);
    assert.equal(readFileSync(join(directory, "files", "forgecy-assets", clientId, "sample.png")).toString(), "png");
  } finally {
    if (db.connection.open) db.connection.close();
    const current = (globalThis as typeof globalThis & { __forgecyLocalDb?: import("better-sqlite3").Database }).__forgecyLocalDb;
    if (current?.open) current.close();
    delete (globalThis as typeof globalThis & { __forgecyLocalDb?: unknown }).__forgecyLocalDb;
    delete process.env.FORGECY_DATA_DIR;
    rmSync(directory, { recursive: true, force: true });
  }
});
