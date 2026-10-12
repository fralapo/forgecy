/**
 * Brand Book exports. The Internal Brand System ZIP is built in the request (it is
 * a few JSON files plus the logo and font sources, no rendering) and is born
 * `exported`: it needs no approval (UX spec UXA-P3-01). Only approved versions are
 * exported, never a draft.
 */
import { listBrandExamples, parseDocument, type TokenTree } from "@forgecy/brand";
import { assertCan, type Actor } from "@forgecy/core";
import {
  and,
  brandBookExports,
  brandIdentityVersions,
  brandSources,
  clients,
  desc,
  eq,
  inArray,
  isNull,
  sql,
  type Database,
} from "@forgecy/db";
import { contentKey, sha256, type StorageDriver } from "@forgecy/files";
import { localizedError } from "@forgecy/i18n";
import type { Readable } from "node:stream";
import {
  assetRefs,
  brandSystemFileName,
  buildBrandSystemFiles,
  zipFiles,
  type BrandSystemAsset,
} from "./system";
import { brandSystemParts, type BrandSystemPart } from "./parts";

export interface BrandBookDeps {
  db: Database;
  storage: StorageDriver;
}

export type BrandBookExportRow = typeof brandBookExports.$inferSelect;

async function readAll(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return new Uint8Array(Buffer.concat(chunks));
}

/** Approved versions that can be exported: the published one and the archived ones. */
export async function exportableVersions(db: Database, actor: Actor, clientId: string) {
  assertCan(actor, "view", clientId);
  return db
    .select({
      id: brandIdentityVersions.id,
      number: brandIdentityVersions.number,
      status: brandIdentityVersions.status,
      publishedAt: brandIdentityVersions.publishedAt,
      changelog: brandIdentityVersions.changelog,
    })
    .from(brandIdentityVersions)
    .where(
      and(
        eq(brandIdentityVersions.clientId, clientId),
        inArray(brandIdentityVersions.status, ["published", "archived"]),
        sql`${brandIdentityVersions.publishedAt} is not null`,
      ),
    )
    .orderBy(desc(brandIdentityVersions.number));
}

export async function listBrandBookExports(db: Database, actor: Actor, clientId: string) {
  assertCan(actor, "view", clientId);
  return db
    .select()
    .from(brandBookExports)
    .where(eq(brandBookExports.clientId, clientId))
    .orderBy(desc(brandBookExports.number))
    .limit(200);
}

export async function getBrandBookExport(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string },
): Promise<BrandBookExportRow | null> {
  assertCan(actor, "view", input.clientId);
  const [row] = await db
    .select()
    .from(brandBookExports)
    .where(and(eq(brandBookExports.id, input.id), eq(brandBookExports.clientId, input.clientId)));
  return row ?? null;
}

/**
 * Builds the Internal Brand System ZIP for an approved version (default: the
 * published one), stores it and records it as BB-n.
 */
export async function exportBrandSystem(
  deps: BrandBookDeps,
  actor: Actor,
  input: { clientId: string; versionId?: string; parts: readonly BrandSystemPart[] },
): Promise<BrandBookExportRow> {
  assertCan(actor, "reports.export", input.clientId);
  const { db, storage } = deps;
  const parts = brandSystemParts.filter((p) => input.parts.includes(p));
  if (!parts.length) throw localizedError("validation", "brand.book.errors.noParts");

  const client = await db.query.clients.findFirst({ where: eq(clients.id, input.clientId) });
  if (!client) throw localizedError("not_found", "brand.errors.clientNotFound");
  const history = await exportableVersions(db, actor, input.clientId);
  const pick = input.versionId
    ? history.find((v) => v.id === input.versionId)
    : history.find((v) => v.status === "published");
  if (!pick) throw localizedError("validation", "brand.book.errors.noPublished");
  const [row] = await db
    .select()
    .from(brandIdentityVersions)
    .where(eq(brandIdentityVersions.id, pick.id));
  if (!row?.publishedAt) throw localizedError("validation", "brand.book.errors.noPublished");
  const publishedAt = row.publishedAt;
  const document = parseDocument(row.document);

  const sources = await db
    .select({
      id: brandSources.id,
      kind: brandSources.kind,
      title: brandSources.title,
      url: brandSources.url,
      mime: brandSources.mime,
      size: brandSources.size,
      status: brandSources.status,
      capturedAt: brandSources.capturedAt,
      storageKey: brandSources.storageKey,
    })
    .from(brandSources)
    .where(and(eq(brandSources.clientId, input.clientId), isNull(brandSources.removedAt)))
    .orderBy(brandSources.capturedAt);
  const examples = parts.includes("examples")
    ? await listBrandExamples(db, actor, input.clientId, { limit: 500 })
    : [];

  const assets: BrandSystemAsset[] = [];
  if (parts.includes("assets")) {
    const keyOf = new Map(sources.map((s) => [s.id, s.storageKey]));
    for (const ref of assetRefs(document, sources)) {
      const key = keyOf.get(ref.sourceId);
      if (!key || !(await storage.exists(key))) continue;
      assets.push({ ...ref, bytes: await readAll(await storage.get(key)) });
    }
  }

  return db.transaction(async (tx) => {
    // One BB-n sequence per client: serialize concurrent exports.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`brand_book:${client.id}`}))`);
    const [last] = await tx
      .select({ n: sql<number>`coalesce(max(${brandBookExports.number}), 0)::int` })
      .from(brandBookExports)
      .where(eq(brandBookExports.clientId, client.id));
    const number = (last?.n ?? 0) + 1;
    const files = buildBrandSystemFiles(
      {
        client: { name: client.name, slug: client.slug },
        version: {
          id: row.id,
          number: row.number,
          publishedAt,
          document,
          tokens: row.tokens as TokenTree,
        },
        history,
        sources: sources.map(({ storageKey: _key, ...s }) => s),
        examples,
        assets,
        generatedAt: new Date(),
      },
      parts,
    );
    const fileName = brandSystemFileName(client.slug, row.number, number);
    const zip = zipFiles(files, fileName.replace(/\.zip$/, ""));
    const key = contentKey({
      clientId: client.id,
      scope: "brand-book",
      sha256: sha256(zip),
      ext: "zip",
    });
    await storage.put(key, zip, { contentType: "application/zip" });
    const [created] = await tx
      .insert(brandBookExports)
      .values({
        clientId: client.id,
        number,
        type: "brand_system",
        status: "exported",
        brandVersionId: row.id,
        brandVersionNumber: row.number,
        parts: [...parts],
        storageKey: key,
        fileName,
        bytes: zip.byteLength,
        createdBy: actor.type === "user" ? actor.id : null,
      })
      .returning();
    return created!;
  });
}
