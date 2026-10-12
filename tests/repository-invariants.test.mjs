import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";

const migration=(n)=>readFileSync("supabase/migrations/"+n,"utf8");
test("entire previous application retained at old/",()=>{
 assert.ok(existsSync("old/README.md"));
 assert.ok(existsSync("old/apps/web"));
 assert.ok(existsSync("old/LICENSE"));
});
test("tenant tables have row-level security enabled",()=>{
 const s=migration("0001_init.sql");
 assert.match(s,/alter table public\.clients enable row level security/i);
 assert.match(s,/owns_forgecy_client/i);
 assert.match(s,/foreach t in array/i);
 assert.match(s,/storage\.buckets/i);
});
test("mission approval is atomic and guarded",()=>{
 const s=migration("0003_knowledge_versions.sql");
 assert.match(s,/for update/i);
 assert.match(s,/m\.status<>'proposed'/i);
 assert.match(s,/doc_rev<>knowledge_rev/i);
 assert.match(s,/insert into public\.contents/i);
});
test("new knowledge invalidates current dossier and linked content",()=>{
 const s=migration("0003_knowledge_versions.sql");
 assert.match(s,/knowledge_revision=knowledge_revision\+1/i);
 assert.match(s,/update public\.dossiers set status='stale'/i);
 assert.match(s,/update public\.contents set status='stale'/i);
});
test("provider secrets are only in server environment variables",()=>{
 const env=readFileSync(".env.example","utf8");
 assert.ok(env.includes("OPENROUTER_API_KEY="));
 assert.ok(!env.includes("NEXT_PUBLIC_OPENROUTER_API_KEY"));
});
