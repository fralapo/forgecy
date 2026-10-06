/**
 * Fixed development data: fake clients only, never real ones. Idempotent (upserts on slug).
 * Module threads extend it with their own fixtures (brand identities, carousels...).
 */
import { createDb } from "./client";
import { clients } from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const db = createDb(url, { max: 1 });

const fixtures: (typeof clients.$inferInsert)[] = [
  {
    name: "Trattoria Da Mario (demo)",
    slug: "demo-trattoria-da-mario",
    status: "prospect",
    websiteUrl: "https://example.com",
    sector: "Ristorazione",
    aiPolicy: "external_allowed",
    notes: "Cliente di prova per lo sviluppo.",
  },
  {
    name: "Studio Verdi Architetti (demo)",
    slug: "demo-studio-verdi",
    status: "active",
    websiteUrl: "https://example.org",
    sector: "Architettura",
    aiPolicy: "local_only",
    notes: "Cliente di prova con policy local_only.",
  },
];

for (const row of fixtures) {
  await db
    .insert(clients)
    .values(row)
    .onConflictDoUpdate({ target: clients.slug, set: { name: row.name } });
}
await db.$client.end();
console.log(`Seeded ${fixtures.length} demo clients`);
