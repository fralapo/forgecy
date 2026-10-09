import type { SiteProbe } from "@forgecy/audit";
import type { AiGateway } from "@forgecy/ai";
import type { Actor } from "@forgecy/core";
import {
  auditEvents,
  brandIdentityProposals,
  brandSources,
  clients,
  createDb,
  eq,
  sql,
  users,
  type Database,
} from "@forgecy/db";
import type { StorageDriver } from "@forgecy/files";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AnalystItem } from "../src/import/analyst";
import { runSourceImport } from "../src/import/run";
import { addSource, updateSourceStatus } from "../src/service";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

const PAGES = [
  {
    locator: "/",
    text: "DeoDue è bifase: una fase ammorbidisce, l’altra è solo profumo. Nata nel Sud Italia.",
  },
  { locator: "/about", text: "Siamo una famiglia che produce deodoranti dal 1998." },
];

const VISUAL: SiteProbe = {
  cssVars: [{ name: "--brand-primary", hex: "#1d3a8a" }],
  themeColor: "#f5ebdc",
  buttonColors: [{ hex: "#007bff", role: "bg", weight: 100 }],
  fonts: [
    { family: "Playfair Display", roles: ["headings"], loaded: true },
    { family: "Arial", roles: ["body"], loaded: false },
  ],
  logos: [],
  images: [],
};

const common = { rationale: "From the home page", confidence: 0.8 };
const item = (over: Record<string, unknown>) =>
  ({
    locator: "/",
    quote: "una fase ammorbidisce, l'altra è solo profumo",
    ...common,
    ...over,
  }) as AnalystItem;

const ITEMS: AnalystItem[] = [
  item({ field: "positioning", text: "Il deodorante bifase del Sud Italia" }),
  item({
    field: "mission",
    text: "Dare un profumo vero",
    quote: "Il deodorante più amato d'Italia",
  }),
  item({ field: "color", name: "Azzurro", hex: "#0000FF", usage: "fragrance variant" }),
  item({ field: "color", name: "Blu DeoDue", hex: "#1D3A8A", usage: "primary" }),
  item({ field: "color", name: "Bootstrap blue", hex: "#007bff", usage: "accent" }),
  item({ field: "typography", role: "display", family: "Comic Sans", weights: [] }),
];

const fakeAi = (items: AnalystItem[]) => {
  const seen: Array<{ system: string; input: string }> = [];
  const ai = {
    generateObject: async (req: { system: string; input: string }) => {
      seen.push({ system: req.system, input: req.input });
      return { data: { items }, provider: "openrouter", model: "fake/model" };
    },
  } as unknown as AiGateway;
  return { ai, seen };
};

describe.skipIf(!dbUrl)("runSourceImport on a website (integration)", () => {
  let db: Database;
  let clientId: string;
  let anna: Extract<Actor, { type: "user" }>;
  const suffix = Math.random().toString(36).slice(2, 8);
  const storage = {} as StorageDriver;

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 4 });
    const [c] = await db
      .insert(clients)
      .values({ name: `Run ${suffix}`, slug: `brand-run-${suffix}` })
      .returning();
    clientId = c!.id;
    const [u] = await db
      .insert(users)
      .values({ name: "anna", email: `anna-${suffix}@example.test` })
      .returning();
    anna = { type: "user", id: u!.id, isAdmin: false, active: true, clients: "all" };
  });

  afterAll(async () => {
    if (db && clientId) {
      for (const table of [
        "brand_identity_proposals",
        "brand_identity_versions",
        "brand_identities",
        "brand_sources",
        "audit_events",
      ])
        await db.execute(sql`delete from ${sql.identifier(table)} where client_id = ${clientId}`);
      await db.delete(clients).where(eq(clients.id, clientId));
      await db.execute(sql`delete from users where email like ${"%-" + suffix + "@example.test"}`);
    }
    await db?.$client.end();
  });

  const run = async (
    source: { kind: "website" | "document"; visual?: unknown },
    items: AnalystItem[],
  ) => {
    const s = await addSource(db, anna, { clientId, kind: source.kind, title: "Site" });
    await updateSourceStatus(db, s.id, {
      pages: PAGES,
      ...(source.visual !== undefined ? { visual: source.visual as Record<string, unknown> } : {}),
    });
    const { ai, seen } = fakeAi(items);
    const result = await runSourceImport(
      { db, storage, ai },
      { jobId: crypto.randomUUID(), attempt: 1, maxAttempts: 1 },
      { clientId, sourceId: s.id },
    );
    const proposals = await db
      .select()
      .from(brandIdentityProposals)
      .where(eq(brandIdentityProposals.clientId, clientId));
    const [row] = await db.select().from(brandSources).where(eq(brandSources.id, s.id));
    return {
      s,
      result,
      seen,
      row: row!,
      mine: proposals.filter((p) => p.evidence[0]?.sourceId === s.id),
    };
  };

  it("proposes the site's own colors and fonts, and drops what the site does not support", async () => {
    const { result, seen, row, mine } = await run({ kind: "website", visual: VISUAL }, ITEMS);

    // Known lists reach the analyst, with the website prompt.
    expect(seen[0]!.system).toContain('ONLY among the "Known colors"');
    expect(seen[0]!.input).toContain("- #1d3a8a (primary)");
    expect(seen[0]!.input).toContain("- Playfair Display (headings)");
    expect(seen[0]!.input).not.toContain("#007bff"); // framework default, not offered
    expect(seen[0]!.input).not.toContain("#0000FF");

    const paths = mine.map((p) => p.fieldPath);
    // CSS-derived colors: brand variable (named by the analyst), theme-color. Not the Bootstrap blue.
    const colorTitles = mine.filter((p) => p.fieldPath.startsWith("/tokens/color/reference/"));
    expect(colorTitles.map((p) => p.fieldPath).sort()).toEqual([
      "/tokens/color/reference/blu-deodue",
      "/tokens/color/reference/theme-color",
    ]);
    const blu = mine.find((p) => p.fieldPath === "/tokens/color/reference/blu-deodue")!;
    expect(JSON.stringify(blu.changes)).toContain("primary");
    // Typography from the loaded font only; the invented one is gone.
    const typography = mine.filter((p) => p.fieldPath.startsWith("/document/visual/typography"));
    expect(JSON.stringify(typography.map((p) => p.changes))).toContain("Playfair Display");
    expect(JSON.stringify(typography.map((p) => p.changes))).not.toContain("Comic Sans");
    // The verified positioning is in, the invented quote is out.
    expect(paths).toContain("/document/strategy/positioning");
    expect(paths).not.toContain("/document/strategy/mission");

    // Azzurro #0000FF, the Bootstrap blue, the invented mission and Comic Sans.
    expect(result.discarded).toBe(4);
    expect(row.statusDetail).toContain("4 items discarded: not verifiable");
    expect(row.statusDetailRef?.map((r) => r.key)).toContain("brand.import.status.discarded");
    expect(mine.every((p) => p.status === "proposed")).toBe(true);

    const events = await db.select().from(auditEvents).where(eq(auditEvents.clientId, clientId));
    expect(
      events.some(
        (e) =>
          (e.meta as { promptVersion?: string } | null)?.promptVersion ===
          "brand-analyst/website@1",
      ),
    ).toBe(true);
  });

  it("discards every analyst color and font when the site has no visual data", async () => {
    const { result, mine, seen } = await run({ kind: "website" }, ITEMS);
    expect(seen[0]!.input).toContain("Known colors:\nnone");
    expect(mine.some((p) => p.fieldPath.startsWith("/tokens/"))).toBe(false);
    expect(mine.some((p) => p.fieldPath.startsWith("/document/visual/typography"))).toBe(false);
    expect(result.discarded).toBe(5);
  });

  it("treats a malformed stored probe as absent", async () => {
    const { result } = await run({ kind: "website", visual: { cssVars: "oops" } }, ITEMS);
    expect(result.discarded).toBe(5);
  });

  it("leaves document sources as they were: old prompt, colors and quotes not gated", async () => {
    const { result, seen, mine } = await run({ kind: "document" }, ITEMS);
    expect(seen[0]!.system).toContain("brand materials");
    expect(seen[0]!.input).not.toContain("Known colors");
    expect(result.discarded).toBe(0);
    expect(mine.map((p) => p.fieldPath)).toContain("/document/strategy/mission");
    expect(mine.some((p) => p.fieldPath.includes("/tokens/color/reference/"))).toBe(true);
  });
});
