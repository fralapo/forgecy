import { describe, expect, it } from "vitest";
import type { PackageManifest } from "../src/export";
import { clientTables, TABLE_AREAS } from "../src/graph";
import type { ClientPackage } from "../src/package";
import {
  assertImportKey,
  assertPackageData,
  assertPackageScoped,
  emptyOutsideRefs,
  UnsafePackageError,
  type Row,
} from "../src/safety";

const ME = "11111111-1111-4111-8111-11111111111a";
const VICTIM = "99999999-9999-4999-8999-99999999999b";
const ROW = "22222222-2222-4222-8222-22222222222c";
const PILLAR = "33333333-3333-4333-8333-33333333333d";
const SHA = "a".repeat(64);
const table = (name: string) => clientTables().find((t) => t.name === name)!;
const idsOf = (m: Record<string, string[]>) =>
  new Map(Object.entries(m).map(([t, ids]) => [t, new Set(ids)]));
const scope = (over: Partial<Parameters<typeof assertPackageScoped>[2]> = {}) => ({
  clientId: ME,
  idsByTable: idsOf({ clients: [ME], contents: [ROW], content_pillars: [PILLAR] }),
  areas: new Set(["client", "content"]),
  ...over,
});
const runOn = (t: ReturnType<typeof table>, rows: Row[], s = scope()) =>
  assertPackageScoped([t], new Map([[t.name, rows]]), s);
const run = (name: string, rows: Row[], s = scope()) => runOn(table(name), rows, s);
const problemOf = (fn: () => void) => {
  try {
    fn();
  } catch (err) {
    return err instanceof UnsafePackageError ? err.problem : `other: ${String(err)}`;
  }
  return "none";
};

describe("assertPackageScoped", () => {
  const content = (over: Row = {}): Row => ({
    id: ROW,
    client_id: ME,
    title: "t",
    draft: { image: `clients/${ME}/assets/${SHA}.png` },
    ...over,
  });

  it("accepts rows that only point inside the package", () => {
    expect(() => run("contents", [content({ pillar_id: PILLAR })])).not.toThrow();
  });
  it("refuses a client_id that is another client, by either of its two guards", () => {
    const bad = [content({ client_id: VICTIM })];
    expect(() => run("contents", bad)).toThrow(UnsafePackageError);
    // Each guard alone is enough: the schema-independent client_id rule...
    expect(() => runOn({ ...table("contents"), parents: [] }, bad)).toThrow(/client_id/);
    // ...and the foreign-key rule.
    expect(() => runOn({ ...table("contents"), hasClientId: false }, bad)).toThrow(/client_id/);
  });
  it("refuses a foreign key to a row that is not in the package", () => {
    expect(() => run("contents", [content({ pillar_id: VICTIM })])).toThrow(/pillar_id/);
  });
  it("refuses a foreign key that names a package row of the wrong table", () => {
    // ROW is a content, not a pillar.
    expect(() => run("contents", [content({ pillar_id: ROW })])).toThrow(/pillar_id/);
  });
  it("refuses a client_id that is another row of the package", () => {
    expect(() => run("contents", [content({ client_id: ROW })])).toThrow(UnsafePackageError);
  });
  it("refuses a NOT NULL parent left empty", () => {
    expect(() => run("contents", [content({ client_id: null })])).toThrow(/empty/);
  });
  it("refuses another client's storage key anywhere in the row, even deep in JSON", () => {
    const key = `clients/${VICTIM}/assets/${SHA}.png`;
    expect(() => run("contents", [content({ draft: { slides: [{ bg: { src: key } }] } })])).toThrow(
      /another client/,
    );
  });
  it("allows agency files and a null client_id on templates", () => {
    expect(() =>
      run("templates", [{ id: ROW, client_id: null, package_key: `system/templates/${SHA}.zip` }]),
    ).not.toThrow();
  });

  describe("storage keys in row text must name exactly this client", () => {
    const text = (s: string) => () =>
      run("contents", [content({ draft: { slides: [{ src: s }] } })]);
    it("accepts the client's own key", () => {
      expect(text(`clients/${ME}/x/y.pdf`)).not.toThrow();
    });
    const bad: Record<string, string> = {
      "an upper-case copy of this client id": `clients/${ME.toUpperCase()}/x/y.pdf`,
      "an upper-case prefix": `CLIENTS/${ME}/x`,
      "a mixed-case prefix": `Clients/${ME}/x`,
      "a mixed-case prefix and id": `cLiEnTs/${ME.slice(0, 20)}${ME.slice(20).toUpperCase()}/x`,
      "another client, lower case": `clients/${VICTIM}/x/y.pdf`,
      "another client, upper case": `CLIENTS/${VICTIM.toUpperCase()}/x`,
      "a key after other text": `see also: clients/${VICTIM}/a.png`,
    };
    for (const [name, s] of Object.entries(bad))
      it(`refuses ${name}`, () => {
        expect(problemOf(text(s))).toBe("unsafe");
      });
    it("looks in every column, not only storage-key columns", () => {
      const row = { id: ROW, client_id: ME, title: `clients/${ME.toUpperCase()}/x` };
      expect(problemOf(() => run("contents", [row]))).toBe("unsafe");
    });
  });

  describe("ids are canonical lower-case uuids, exactly as the importer maps them", () => {
    const forms = {
      upper: ROW.toUpperCase(),
      hyphenless: ROW.replaceAll("-", ""),
      braced: `{${ROW}}`,
      urn: `urn:uuid:${ROW}`,
    };
    for (const [name, form] of Object.entries(forms)) {
      it(`refuses a ${name} row id`, () => {
        expect(problemOf(() => run("contents", [content({ id: form })]))).toBe("unsafe");
      });
      it(`refuses a ${name} client_id`, () => {
        expect(problemOf(() => run("contents", [content({ client_id: form })]))).toBe("unsafe");
      });
      it(`refuses a ${name} foreign key`, () => {
        expect(problemOf(() => run("contents", [content({ pillar_id: form })]))).toBe("unsafe");
      });
    }
    it("refuses an id that is not text", () => {
      expect(problemOf(() => run("contents", [content({ id: 7 })]))).toBe("unsafe");
    });
  });

  describe("references that are not declared foreign keys", () => {
    it("are found from the schema", () => {
      const soft = (t: string) => table(t).softRefs.map((s) => s.column);
      expect(soft("contents")).toContain("product_id");
      expect(soft("brand_check_runs")).toContain("subject_id");
      expect(soft("brand_check_issue_states")).toContain("subject_id");
      expect(soft("brand_examples")).toContain("content_version_id");
      expect(soft("audit_reports")).toContain("template_id");
      expect(soft("brand_identity_proposals")).toContain("run_id");
    });
    it("accept null and a row of the right table in the package", () => {
      const s = scope({
        idsByTable: idsOf({ clients: [ME], contents: [ROW], products: [PILLAR] }),
      });
      expect(() => run("contents", [content({ product_id: null })], s)).not.toThrow();
      expect(() => run("contents", [content({ product_id: PILLAR })], s)).not.toThrow();
    });
    it("refuse a product id that is not in the package, or that is a row of another table", () => {
      const s = scope({
        areas: new Set(["client", "content", "products"]),
        idsByTable: idsOf({ clients: [ME], contents: [ROW], products: [] }),
      });
      expect(problemOf(() => run("contents", [content({ product_id: VICTIM })], s))).toBe("unsafe");
      expect(problemOf(() => run("contents", [content({ product_id: ROW })], s))).toBe("unsafe");
      expect(problemOf(() => run("contents", [content({ product_id: "nope" })], s))).toBe("unsafe");
    });
    it("polymorphic check subjects must be package contents", () => {
      const state = { id: ROW, client_id: ME, subject_type: "carousel" };
      expect(
        problemOf(() =>
          run(
            "brand_check_issue_states",
            [{ ...state, subject_id: VICTIM }],
            scope({ areas: new Set(["client", "content", "brand"]) }),
          ),
        ),
      ).toBe("unsafe");
    });
    it("outside references to jobs and report templates are not checked: the import empties them", () => {
      const nullable = table("brand_identity_proposals").softRefs.find(
        (s) => s.column === "run_id",
      )!;
      expect(nullable).toMatchObject({ mode: "nullIfOutside", notNull: false });
      expect(table("audit_reports").softRefs.find((s) => s.column === "template_id")!.mode).toBe(
        "nullIfOutside",
      );
    });
  });

  describe("the import empties references to things that do not travel", () => {
    it("keeps a report template of the package and drops a stranger's", () => {
      const reports = table("audit_reports");
      const here = new Map([["templates", new Set([ROW])]]);
      const kept: Row = { template_id: ROW };
      const dropped: Row = { template_id: VICTIM };
      emptyOutsideRefs(reports, kept, here);
      emptyOutsideRefs(reports, dropped, here);
      expect(kept.template_id).toBe(ROW);
      expect(dropped.template_id).toBeNull();
    });
    it("keeps only ids of the target table: a package row of another table does not count", () => {
      const row: Row = { template_id: ROW };
      emptyOutsideRefs(table("audit_reports"), row, new Map([["contents", new Set([ROW])]]));
      expect(row.template_id).toBeNull();
    });
    it("drops a job id and leaves package references alone", () => {
      const row: Row = { run_id: VICTIM };
      emptyOutsideRefs(table("brand_identity_proposals"), row, new Map());
      expect(row.run_id).toBeNull();
      const product: Row = { product_id: VICTIM };
      emptyOutsideRefs(table("contents"), product, new Map());
      expect(product.product_id).toBe(VICTIM);
    });
  });

  describe("a reference to an area the export left out is told apart from an attack", () => {
    const withoutBrand = scope({ areas: new Set(["client", "content"]) });
    it("is incompleteArea when the target belongs to an optional area that is not in the package", () => {
      const row = content({ brand_version_id: VICTIM });
      expect(problemOf(() => run("contents", [row], withoutBrand))).toBe("incompleteArea");
    });
    it("is incompleteArea for a soft reference too", () => {
      const row = content({ product_id: VICTIM });
      expect(problemOf(() => run("contents", [row], withoutBrand))).toBe("incompleteArea");
    });
    it("is unsafe when the area is in the package and the row is not", () => {
      const row = content({ brand_version_id: VICTIM });
      const withBrand = scope({ areas: new Set(["client", "content", "brand"]) });
      expect(problemOf(() => run("contents", [row], withBrand))).toBe("unsafe");
    });
    it("is unsafe for a malformed id even when the area is missing", () => {
      const row = content({ brand_version_id: "../../x" });
      expect(problemOf(() => run("contents", [row], withoutBrand))).toBe("unsafe");
    });
    it("is unsafe for another client's id: the client is never an optional area", () => {
      expect(problemOf(() => run("contents", [content({ client_id: VICTIM })], withoutBrand))).toBe(
        "unsafe",
      );
    });
  });

  it("knows the area of every table it can point to", () => {
    for (const t of clientTables())
      for (const p of t.parents) expect(TABLE_AREAS[p.target]).toBeTruthy();
  });
});

describe("assertImportKey", () => {
  it("accepts this client's keys and content-addressed agency keys", () => {
    expect(() => assertImportKey(`clients/${ME}/assets/${SHA}.png`, ME, SHA)).not.toThrow();
    expect(() => assertImportKey(`system/templates/${SHA}.zip`, ME, SHA)).not.toThrow();
  });
  it("refuses another client, odd system shapes, bad syntax and a wrong embedded checksum", () => {
    expect(() => assertImportKey(`clients/${VICTIM}/assets/${SHA}.png`, ME)).toThrow(
      UnsafePackageError,
    );
    expect(() => assertImportKey("system/anything/else.bin", ME)).toThrow(UnsafePackageError);
    expect(() => assertImportKey(`clients/${ME}/../${VICTIM}/x.png`, ME)).toThrow(
      UnsafePackageError,
    );
    expect(() => assertImportKey(`system/templates/${SHA}.zip`, ME, "b".repeat(64))).toThrow(
      /checksum/,
    );
  });
  it("refuses absolute paths and backslashes", () => {
    expect(() => assertImportKey(`/clients/${ME}/assets/${SHA}.png`, ME)).toThrow(
      UnsafePackageError,
    );
    expect(() => assertImportKey(`clients\\${ME}\\assets\\${SHA}.png`, ME)).toThrow(
      UnsafePackageError,
    );
  });
  it("keeps attacker text out of the message: no control characters, at most 80 characters", () => {
    const key = `clients/${ME}/${"x".repeat(500)}\u001b[31m\n\r`;
    let message = "";
    expect(() => {
      try {
        assertImportKey(key, VICTIM);
      } catch (err) {
        message = (err as Error).message;
        throw err;
      }
    }).toThrow(UnsafePackageError);
    expect(message).toContain("clients/");
    expect([...message].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)).toBe(
      false,
    );
    expect(message).not.toContain("x".repeat(100));
  });
});

describe("assertPackageData (the whole package, no database)", () => {
  const fakePackage = (data: Record<string, unknown>, broken: string[] = []): ClientPackage => ({
    names: () => Object.keys(data),
    has: (name) => name in data,
    text: async (name) => {
      if (broken.includes(name)) throw new Error("inflate failed");
      return JSON.stringify(data[name]);
    },
    stream: () => Promise.reject(new Error("not needed")),
    sha256: () => Promise.reject(new Error("not needed")),
    close: () => {},
  });
  const manifest = (
    files: PackageManifest["files"] = [],
    over: Partial<PackageManifest> = {},
  ): PackageManifest =>
    ({
      client: { id: ME, name: "Acme", slug: "acme" },
      areas: ["content"],
      files,
      ...over,
    }) as unknown as PackageManifest;
  const clientRow = { id: ME, name: "Acme", slug: "acme" };
  const pillar = { id: PILLAR, client_id: ME, name: "p" };
  const content = (over: Row = {}): Row => ({ id: ROW, client_id: ME, title: "t", ...over });
  const problem = async (pkg: ClientPackage, m = manifest()) => {
    try {
      await assertPackageData(pkg, m);
    } catch (err) {
      return err instanceof UnsafePackageError ? err.problem : `other: ${String(err)}`;
    }
    return "none";
  };

  it("accepts a package whose rows point at each other", async () => {
    const pkg = fakePackage({
      "data/clients.json": [clientRow],
      "data/content_pillars.json": [pillar],
      "data/contents.json": [content({ pillar_id: PILLAR })],
    });
    await expect(
      assertPackageData(
        pkg,
        manifest([{ key: `clients/${ME}/assets/${SHA}.png`, bytes: 1, sha256: SHA }]),
      ),
    ).resolves.toBeUndefined();
  });
  it("refuses a pillar that is only in the package under another table", async () => {
    // Without the package's own ids a pointer to a sibling row could not be told from a stranger.
    const pkg = fakePackage({
      "data/clients.json": [clientRow],
      "data/contents.json": [content({ pillar_id: ROW })],
    });
    expect(await problem(pkg)).toBe("unsafe");
  });
  it("refuses a row of another client", async () => {
    const pkg = fakePackage({
      "data/clients.json": [clientRow],
      "data/contents.json": [content({ client_id: VICTIM })],
    });
    await expect(assertPackageData(pkg, manifest())).rejects.toThrow(UnsafePackageError);
  });
  it("refuses a foreign key to an existing row of another client", async () => {
    const pkg = fakePackage({
      "data/clients.json": [clientRow],
      "data/contents.json": [content({ pillar_id: VICTIM })],
    });
    await expect(assertPackageData(pkg, manifest())).rejects.toThrow(/pillar_id/);
  });
  it("refuses a file key under another client", async () => {
    const pkg = fakePackage({ "data/clients.json": [clientRow] });
    await expect(
      assertPackageData(
        pkg,
        manifest([{ key: `clients/${VICTIM}/assets/${SHA}.png`, bytes: 1, sha256: SHA }]),
      ),
    ).rejects.toThrow(UnsafePackageError);
  });
  it("refuses an upper-case manifest client id with files under the victim's prefix", async () => {
    const upper = ME.toUpperCase();
    const pkg = fakePackage({ "data/clients.json": [{ ...clientRow, id: upper }] });
    const m = manifest([{ key: `clients/${VICTIM}/assets/${SHA}.png`, bytes: 1, sha256: SHA }], {
      client: { id: upper, name: "Acme", slug: "acme" },
    });
    expect(await problem(pkg, m)).toBe("unsafe");
    // Even with no file: the id itself must be canonical.
    expect(await problem(pkg, manifest([], { client: { id: upper, name: "a", slug: "a" } }))).toBe(
      "unsafe",
    );
  });
  it("refuses a hyphenless or braced manifest client id", async () => {
    for (const id of [ME.replaceAll("-", ""), `{${ME}}`]) {
      const pkg = fakePackage({ "data/clients.json": [{ ...clientRow, id }] });
      expect(await problem(pkg, manifest([], { client: { id, name: "a", slug: "a" } }))).toBe(
        "unsafe",
      );
    }
  });
  it("refuses an upper-case row id", async () => {
    const pkg = fakePackage({
      "data/clients.json": [clientRow],
      "data/contents.json": [content({ id: ROW.toUpperCase() })],
    });
    expect(await problem(pkg)).toBe("unsafe");
  });
  it("refuses a clients row that is not the manifest's client", async () => {
    const pkg = fakePackage({ "data/clients.json": [{ ...clientRow, id: VICTIM }] });
    await expect(assertPackageData(pkg, manifest())).rejects.toThrow(UnsafePackageError);
  });
  it("refuses a package without a clients table", async () => {
    expect(await problem(fakePackage({ "data/contents.json": [content()] }))).toBe("unsafe");
  });
  it("refuses two client rows", async () => {
    const pkg = fakePackage({ "data/clients.json": [clientRow, { ...clientRow, id: ROW }] });
    expect(await problem(pkg)).toBe("unsafe");
  });
  it("refuses table data that is not a list of rows", async () => {
    const pkg = fakePackage({ "data/clients.json": [clientRow], "data/contents.json": { a: 1 } });
    await expect(assertPackageData(pkg, manifest())).rejects.toThrow(UnsafePackageError);
  });
  it("calls an unreadable entry unreadable, not unsafe", async () => {
    const pkg = fakePackage({ "data/clients.json": [clientRow] }, ["data/clients.json"]);
    expect(await problem(pkg)).toBe("unreadable");
  });
  it("tells a partial export (brand left out) from a hostile package", async () => {
    const partial = fakePackage({
      "data/clients.json": [clientRow],
      "data/contents.json": [content({ brand_version_id: VICTIM })],
    });
    expect(await problem(partial)).toBe("incompleteArea");
    const hostile = fakePackage({
      "data/clients.json": [clientRow],
      "data/brand_identity_versions.json": [],
      "data/contents.json": [content({ brand_version_id: VICTIM })],
    });
    expect(await problem(hostile, manifest([], { areas: ["content", "brand"] }))).toBe("unsafe");
  });
});
