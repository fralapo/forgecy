import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipArchive } from "@forgecy/core/testing/archives";
import { clients, createDb, type Database } from "@forgecy/db";
import { LocalDiskDriver } from "@forgecy/files";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importClientPackage } from "../src/import";
import { UnsafePackageError } from "../src/safety";
import { verifyClientPackage } from "../src/verify";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

describe.skipIf(!dbUrl)("hostile client package (integration)", () => {
  let db: Database;
  let dir: string;
  let storage: LocalDiskDriver;
  const suffix = Math.random().toString(36).slice(2, 8);
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const ME = randomUUID();
  const VICTIM = randomUUID();

  /** A package that claims client ME but carries `contents` rows and `files` of its own choosing. */
  const hostile = async (name: string, contentsRows: unknown[], files: string[] = []) => {
    const data: Record<string, string> = {
      clients: JSON.stringify([{ id: ME, name: `Evil ${suffix}`, slug: `evil-${suffix}` }]),
      contents: JSON.stringify(contentsRows),
    };
    const manifest = {
      format: 1,
      app: "forgecy",
      exportedAt: new Date().toISOString(),
      schema: { migrations: 0, last: null },
      client: { id: ME, name: `Evil ${suffix}`, slug: `evil-${suffix}` },
      areas: [],
      options: { excludeUnapprovedAi: false, includeAgencyTemplates: false },
      tables: Object.fromEntries(
        Object.entries(data).map(([t, text]) => [
          t,
          { rows: (JSON.parse(text) as unknown[]).length, sha256: sha(text) },
        ]),
      ),
      files: files.map((key) => ({ key, bytes: 1, sha256: sha("x") })),
      people: 0,
    };
    const file = join(dir, `${name}.zip`);
    await writeFile(
      file,
      zipArchive([
        { name: "manifest.json", data: JSON.stringify(manifest) },
        ...Object.entries(data).map(([t, text]) => ({ name: `data/${t}.json`, data: text })),
        ...files.map((key) => ({ name: `files/${key}`, data: "x" })),
      ]),
    );
    return file;
  };
  const clientCount = async () => (await db.select({ id: clients.id }).from(clients)).length;

  beforeAll(async () => {
    db = createDb(dbUrl!);
    dir = await mkdtemp(join(tmpdir(), "forgecy-unsafe-"));
    storage = new LocalDiskDriver({
      root: join(dir, "media"),
      baseUrl: "http://localhost:3000",
      secret: "test-secret-0123456789",
    });
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    await db.$client.end();
  });

  const cases: [string, () => Promise<string>][] = [
    [
      "a row of another client",
      () => hostile("other-client", [{ id: randomUUID(), client_id: VICTIM, title: "t" }]),
    ],
    [
      "a foreign key to a row that is not in the package",
      () =>
        hostile("foreign-fk", [
          { id: randomUUID(), client_id: ME, title: "t", pillar_id: randomUUID() },
        ]),
    ],
    [
      "a file under another client",
      () => hostile("foreign-file", [], [`clients/${VICTIM}/assets/${"a".repeat(64)}.png`]),
    ],
  ];

  it.each(cases)("refuses %s at Verify and again at Import, writing nothing", async (_n, build) => {
    const file = await build();
    expect((await verifyClientPackage(db, file, 1)).problems).toEqual(["unsafe"]);
    const before = await clientCount();
    await expect(
      importClientPackage({ db, storage }, file, {
        choices: { client: { mode: "new", slug: `evil-${suffix}` }, templates: {} },
      }),
    ).rejects.toThrow(UnsafePackageError);
    expect(await clientCount()).toBe(before);
    expect(await storage.exists(`clients/${VICTIM}/assets/${"a".repeat(64)}.png`)).toBe(false);
  });
});
