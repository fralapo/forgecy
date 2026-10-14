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
    assert.equal(db.connection.pragma("user_version", { simple: true }), 12);
    assert.ok((db.connection.pragma("table_info(ai_preferences)") as {name:string}[]).some(column=>column.name==="ocr_model"));
    const preferenceColumns=db.connection.pragma("table_info(ai_preferences)") as {name:string}[];
    assert.ok(preferenceColumns.some(column=>column.name==="ocr_provider"));
    assert.ok(preferenceColumns.some(column=>column.name==="ocr_auto_update"));
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

    const chunkColumns=db.connection.pragma("table_info(source_chunks)") as {name:string}[];
    assert.ok(chunkColumns.some(column=>column.name==="section_title"));

    const longSource = await db.from("sources").insert({
      client_id: clientId, kind: "document", title: "Scheda tecnica",
      body: "Informazioni generali senza dettagli rilevanti. ".repeat(100)+
        "La formula contiene clorofilla e xantofilla in concentrazione dichiarata.",
      status: "ready"
    }).select().single();
    const passageSearch = await db.rpc("forgecy_search_client_sources", {
      p_client_id: clientId, p_query: "clorofilla OR xantofilla", p_limit: 3
    });
    assert.equal(passageSearch.error, null);
    assert.equal(passageSearch.data[0].source_id, longSource.data.id);
    assert.match(passageSearch.data[0].excerpt, /clorofilla e xantofilla/);
    assert.ok(passageSearch.data[0].chunk_ordinal > 0);

    const semanticParagraph="## Ingredienti speciali\n\nLa formula utilizza olio di jojoba e calendula per la pelle sensibile.";
    const semanticSource=await db.from("sources").insert({client_id:clientId,kind:"website",title:"Scheda ingredienti",body:semanticParagraph,status:"ready"}).select().single();
    const semanticChunk=db.connection.prepare("SELECT id,section_title,body FROM source_chunks WHERE source_id=?").get(semanticSource.data.id) as {id:number;section_title:string;body:string};
    assert.equal(semanticChunk.section_title,"Ingredienti speciali");
    assert.match(semanticChunk.body,/## Ingredienti speciali/);
    assert.equal((await db.rpc("forgecy_search_client_sources",{p_client_id:clientId,p_query:"jojoba OR calendula",p_limit:5})).data[0].source_id,semanticSource.data.id);
    db.connection.prepare("INSERT INTO source_chunk_embeddings(chunk_id,model_id,dimensions,vector,created_at) VALUES(?,?,?,?,?)")
      .run(semanticChunk.id,"test-model",384,Buffer.alloc(384*4),new Date().toISOString());
    const visibleSearch = await db.rpc("forgecy_search_sources", {
      p_client_id: clientId, p_query: "clorofilla OR xantofilla", p_limit: 3
    });
    assert.equal(visibleSearch.data[0].id, longSource.data.id);
    assert.match(visibleSearch.data[0].excerpt, /clorofilla e xantofilla/);

    const updatedSource = await db.from("sources").update({
      body: "Il composto contiene astaxantina e luteina."
    }).eq("id", longSource.data.id).select().single();
    assert.equal(updatedSource.error, null);
    const stalePassageSearch = await db.rpc("forgecy_search_client_sources", {
      p_client_id: clientId, p_query: "clorofilla OR xantofilla", p_limit: 3
    });
    assert.equal(stalePassageSearch.data.length, 0);

    const changed = await db.from("clients").update({ name: "Studio aggiornato" }).eq("id", clientId).select().single();
    assert.equal(changed.error, null);
    assert.equal(changed.data.knowledge_revision, 5);

    const offerWithPhoto=await db.from("offers").insert({client_id:clientId,source_id:semanticSource.data.id,
      image_source_id:semanticSource.data.id,kind:"product",name:"Crema alla calendula",description:"Formula con calendula",status:"verified"}).select().single();
    assert.equal(offerWithPhoto.error,null);
    assert.equal(offerWithPhoto.data.status,"verified");
    assert.equal(offerWithPhoto.data.image_source_id,semanticSource.data.id);
    assert.equal(offerWithPhoto.data.catalog_locked,0);
    const campaignWithOffer=await db.from("campaigns").insert({client_id:clientId,offer_id:offerWithPhoto.data.id,
      title:"Campagna crema",objective:"Presentazione prodotto",period:"Ottobre"}).select().single();
    const contentWithOffer=await db.from("contents").insert({client_id:clientId,campaign_id:campaignWithOffer.data.id,
      offer_id:offerWithPhoto.data.id,channel:"instagram",format:"post",title:"Crema calendula",caption:"Scopri la crema"}).select().single();
    assert.equal(contentWithOffer.error,null);
    const deletedOffer=await db.rpc("forgecy_delete_offer",{p_client_id:clientId,p_offer_id:offerWithPhoto.data.id});
    assert.equal(deletedOffer.error,null);
    assert.equal(deletedOffer.data.contentsDetached,1);
    assert.equal((await db.from("offers").select("id").eq("id",offerWithPhoto.data.id).maybeSingle()).data,null);
    assert.equal((await db.from("campaigns").select("offer_id").eq("id",campaignWithOffer.data.id).single()).data.offer_id,null);
    assert.equal((await db.from("contents").select("offer_id,offer_version").eq("id",contentWithOffer.data.id).single()).data.offer_id,null);

    const reservation = await db.rpc("forgecy_enqueue_ai_job", { p_client_id: clientId, p_kind: "dossier", p_payload: {} });
    assert.equal(reservation.error, null);
    const claimed = await db.rpc("forgecy_claim_ai_job");
    assert.equal(claimed.error, null);
    assert.equal(claimed.data[0].id, reservation.data);
    assert.equal(claimed.data[0].status, "running");
    const crawl100=await db.rpc("forgecy_reserve_website_crawl",{p_client_id:clientId,p_hostname:"example.com",p_page_budget:100});
    assert.equal(crawl100.error,null);

    const snapshot = join(directory, "snapshot.sqlite");
    await db.snapshot(snapshot);
    const copy = new (await import("better-sqlite3")).default(snapshot, { readonly: true });
    assert.equal(copy.pragma("integrity_check", { simple: true }), "ok");
    assert.equal((copy.prepare("SELECT count(*) n FROM sources").get() as { n: number }).n, 3);
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
    const exportedDbPath=join(directory,"exported.sqlite");
    writeFileSync(exportedDbPath,Buffer.from(validated.entries["database/forgecy.sqlite"]));
    const exportedDb=new (await import("better-sqlite3")).default(exportedDbPath,{readonly:true});
    assert.equal((exportedDb.prepare("SELECT count(*) n FROM source_chunk_embeddings").get() as {n:number}).n,1);
    exportedDb.close();
    assert.equal((db.connection.prepare("SELECT count(*) n FROM source_chunk_embeddings").get() as {n:number}).n,1);
    assert.equal(Buffer.from(validated.entries[`files/forgecy-assets/${clientId}/sample.png`]).toString(), "png");
    const scrubbedDbPath = join(directory, "scrubbed.sqlite");
    const scrubbedBytes = Buffer.from(validated.entries["database/forgecy.sqlite"]);
    writeFileSync(scrubbedDbPath, scrubbedBytes);
    const scrubbed = new (await import("better-sqlite3")).default(scrubbedDbPath, { readonly: true });
    assert.equal((scrubbed.prepare("SELECT token_ciphertext FROM social_accounts WHERE remote_id='meta-account'").get() as { token_ciphertext: string }).token_ciphertext, "");
    assert.equal((scrubbed.prepare("SELECT needs_reauth FROM social_accounts WHERE remote_id='meta-account'").get() as { needs_reauth: number }).needs_reauth, 0);
    scrubbed.close();
    const { createAutomaticBackup, listAutomaticBackups, readAutomaticBackup } = await import("../../lib/sync/local-backups");
    const automaticBackup = await createAutomaticBackup();
    assert.equal(listAutomaticBackups()[0].id, automaticBackup.id);
    assert.equal(validateWorkspaceArchive(readAutomaticBackup(automaticBackup.id)).manifest.hash.slice(0, 12), automaticBackup.hashPrefix);
    assert.throws(() => readAutomaticBackup("../../forgecy.sqlite"), /non valido/i);
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
