/**
 * Reading a client package: the ZIP written by `writeClientPackage`. Entries are read on
 * demand, so a large gallery never sits in memory as a whole.
 */
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { CLIENT_PACKAGE_FORMAT, clientTransferAreas } from "@forgecy/core";
import yauzl from "yauzl";
import { z } from "zod";
import type { PackageManifest } from "./export";

export const packageManifestSchema = z.object({
  format: z.number().int().min(1).max(CLIENT_PACKAGE_FORMAT),
  app: z.literal("forgecy"),
  exportedAt: z.string(),
  schema: z.object({ migrations: z.number().int().min(0), last: z.string().nullable() }),
  client: z.object({ id: z.uuid(), name: z.string().min(1), slug: z.string().min(1) }),
  areas: z.array(z.enum(clientTransferAreas)),
  options: z.object({ excludeUnapprovedAi: z.boolean(), includeAgencyTemplates: z.boolean() }),
  tables: z.record(z.string(), z.object({ rows: z.number().int().min(0), sha256: z.string() })),
  files: z.array(z.object({ key: z.string(), bytes: z.number().int().min(0), sha256: z.string() })),
  people: z.number().int().min(0),
}) satisfies z.ZodType<PackageManifest>;

export const packagePeopleSchema = z.array(
  z.object({ id: z.string(), name: z.string(), email: z.string() }),
);
export type PackagePerson = z.infer<typeof packagePeopleSchema>[number];

export interface ClientPackage {
  names(): string[];
  has(name: string): boolean;
  stream(name: string): Promise<Readable>;
  text(name: string): Promise<string>;
  sha256(name: string): Promise<string>;
  close(): void;
}

/** Opens the ZIP at `file`; throws when it is not a readable ZIP. */
export async function openClientPackage(file: string): Promise<ClientPackage> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, z) =>
      err || !z ? reject(err ?? new Error("Unreadable ZIP")) : resolve(z),
    ),
  );
  const entries = new Map<string, yauzl.Entry>();
  await new Promise<void>((resolve, reject) => {
    zip.on("entry", (e: yauzl.Entry) => {
      if (!e.fileName.endsWith("/")) entries.set(e.fileName, e);
      zip.readEntry();
    });
    zip.on("end", () => resolve());
    zip.on("error", reject);
    zip.readEntry();
  });

  const stream = (name: string) => {
    const entry = entries.get(name);
    if (!entry) return Promise.reject(new Error(`Missing entry ${name}`));
    return new Promise<Readable>((resolve, reject) =>
      zip.openReadStream(entry, (err, s) =>
        err || !s ? reject(err ?? new Error(`Unreadable entry ${name}`)) : resolve(s),
      ),
    );
  };
  const buffer = async (name: string) => {
    const chunks: Buffer[] = [];
    for await (const chunk of await stream(name)) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  };
  return {
    names: () => [...entries.keys()],
    has: (name) => entries.has(name),
    stream,
    text: async (name) => (await buffer(name)).toString("utf8"),
    sha256: async (name) => {
      const hash = createHash("sha256");
      for await (const chunk of await stream(name)) hash.update(chunk as Buffer);
      return hash.digest("hex");
    },
    close: () => zip.close(),
  };
}
