import { describe, expect, it } from "vitest";
import type { PackageManifest } from "../src/export";
import { clientTables } from "../src/graph";
import type { ClientPackage } from "../src/package";
import {
  assertImportKey,
  assertPackageData,
  assertPackageScoped,
  UnsafePackageError,
  type Row,
} from "../src/safety";

const ME = "11111111-1111-4111-8111-111111111111";
const VICTIM = "99999999-9999-4999-8999-999999999999";
const ROW = "22222222-2222-4222-8222-222222222222";
const SHA = "a".repeat(64);
const table = (name: string) => clientTables().find((t) => t.name === name)!;
const scope = { clientId: ME, allowedIds: new Set([ME, ROW]) };
const run = (name: string, rows: Row[]) =>
  assertPackageScoped([table(name)], new Map([[name, rows]]), scope);

describe("assertPackageScoped", () => {
  const content = (over: Row = {}): Row => ({
    id: ROW,
    client_id: ME,
    title: "t",
    draft: { image: `clients/${ME}/assets/${SHA}.png` },
    ...over,
  });

  it("accepts rows that only point inside the package", () => {
    expect(() => run("contents", [content()])).not.toThrow();
  });
  it("refuses a client_id that is another client", () => {
    expect(() => run("contents", [content({ client_id: VICTIM })])).toThrow(UnsafePackageError);
  });
  it("refuses a foreign key to a row that is not in the package", () => {
    expect(() => run("contents", [content({ pillar_id: VICTIM })])).toThrow(/pillar_id/);
  });
  it("refuses a client_id that is another row of the package", () => {
    expect(() => run("contents", [content({ client_id: ROW })])).toThrow(UnsafePackageError);
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
});

describe("assertPackageData (the whole package, no database)", () => {
  const fakePackage = (data: Record<string, unknown>): ClientPackage => ({
    names: () => Object.keys(data),
    has: (name) => name in data,
    text: async (name) => JSON.stringify(data[name]),
    stream: () => Promise.reject(new Error("not needed")),
    sha256: () => Promise.reject(new Error("not needed")),
    close: () => {},
  });
  const manifest = (files: PackageManifest["files"] = []): PackageManifest =>
    ({ client: { id: ME, name: "Acme", slug: "acme" }, files }) as unknown as PackageManifest;
  const clientRow = { id: ME, name: "Acme", slug: "acme" };
  const content = (over: Row = {}): Row => ({ id: ROW, client_id: ME, title: "t", ...over });

  it("accepts a package that stays inside its client", async () => {
    const pkg = fakePackage({
      "data/clients.json": [clientRow],
      "data/contents.json": [content()],
    });
    await expect(
      assertPackageData(
        pkg,
        manifest([{ key: `clients/${ME}/assets/${SHA}.png`, bytes: 1, sha256: SHA }]),
      ),
    ).resolves.toBeUndefined();
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
  it("refuses a clients row that is not the manifest's client", async () => {
    const pkg = fakePackage({ "data/clients.json": [{ ...clientRow, id: VICTIM }] });
    await expect(assertPackageData(pkg, manifest())).rejects.toThrow(UnsafePackageError);
  });
  it("refuses table data that is not a list of rows", async () => {
    const pkg = fakePackage({ "data/clients.json": [clientRow], "data/contents.json": { a: 1 } });
    await expect(assertPackageData(pkg, manifest())).rejects.toThrow(UnsafePackageError);
  });
});
