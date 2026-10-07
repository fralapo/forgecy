/**
 * Client image library for slides. Files are content-addressed under
 * `clients/<id>/assets/`, so the renderer's asset resolver accepts them and the same
 * file is stored once. Uploads by a person and product photos are usable at once;
 * AI images stay drafts until a person approves them (spec "AI images").
 */
import type { ProviderId } from "@forgecy/core";
import type { Actor } from "@forgecy/core";
import {
  aiConnections,
  and,
  appSettings,
  assets,
  desc,
  eq,
  inArray,
  isNull,
  or,
  recordAuditEvent,
  sql,
  users,
  type Database,
} from "@forgecy/db";
import { assertValidUpload, contentKey, sha256, type StorageDriver } from "@forgecy/files";
import { z } from "zod";
import { conflict, humanOnly, invalid, notFound, parseOrThrow, type Executor } from "./access";
import { assetRightsBases, type AssetRightsBasis } from "./document";
import { productSource } from "./products";

export type AssetRow = typeof assets.$inferSelect;

/** Pixel size from the file header (PNG, JPEG, WebP, GIF); null when unknown. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const u16 = (o: number) => (b[o]! << 8) | b[o + 1]!;
  const u16le = (o: number) => b[o]! | (b[o + 1]! << 8);
  const u32 = (o: number) =>
    ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { width: u32(16), height: u32(20) };
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49) return { width: u16le(6), height: u16le(8) };
  if (b.length > 30 && b[0] === 0x52 && b[8] === 0x57) {
    const chunk = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
    if (chunk === "VP8 ") return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X")
      return {
        width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)),
        height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)),
      };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) return null;
      const marker = b[o + 1]!;
      const len = u16(o + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { width: u16(o + 7), height: u16(o + 5) };
      o += 2 + len;
    }
  }
  return null;
}

interface StoreInput {
  clientId: string;
  bytes: Uint8Array;
  declaredMime: string;
  source: "upload" | "ai" | "product";
  status: "draft" | "approved";
  alt?: string;
  tags?: string[];
  generation?: Record<string, unknown> | null;
  productId?: string | null;
  contentId?: string | null;
  jobId?: string | null;
  createdBy: string | null;
}

/** Validate, store once by hash and register the file; an identical file returns the existing row. */
export async function storeAsset(db: Executor, storage: StorageDriver, input: StoreInput) {
  const type = assertValidUpload({
    kind: "image",
    mime: input.declaredMime,
    size: input.bytes.length,
    firstBytes: input.bytes.slice(0, 1024),
  });
  const hash = sha256(input.bytes);
  const [existing] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.clientId, input.clientId), eq(assets.sha256, hash)));
  if (existing) return { row: existing, created: false };
  const key = contentKey({
    clientId: input.clientId,
    scope: "assets",
    sha256: hash,
    ext: type.ext,
  });
  if (!(await storage.exists(key)))
    await storage.put(key, input.bytes, {
      contentType: type.mime,
      contentLength: input.bytes.length,
    });
  const size = imageSize(input.bytes);
  const [row] = await db
    .insert(assets)
    .values({
      clientId: input.clientId,
      source: input.source,
      status: input.status,
      storageKey: key,
      sha256: hash,
      mime: type.mime,
      size: input.bytes.length,
      width: size?.width ?? null,
      height: size?.height ?? null,
      alt: (input.alt ?? "").trim().slice(0, 300),
      tags: (input.tags ?? [])
        .map((t) => t.trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, 20),
      generation: input.generation ?? null,
      productId: input.productId ?? null,
      contentId: input.contentId ?? null,
      jobId: input.jobId ?? null,
      createdBy: input.createdBy,
      ...(input.status === "approved" && input.createdBy
        ? { decidedBy: input.createdBy, decidedAt: new Date() }
        : {}),
    })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    const [again] = await db
      .select()
      .from(assets)
      .where(and(eq(assets.clientId, input.clientId), eq(assets.sha256, hash)));
    return { row: again!, created: false };
  }
  return { row, created: true };
}

export async function uploadAsset(
  db: Database,
  storage: StorageDriver,
  actor: Actor,
  input: {
    clientId: string;
    bytes: Uint8Array;
    mime: string;
    alt?: string;
    tags?: string[];
    contentId?: string | null;
  },
) {
  humanOnly(actor, "assets.upload", input.clientId);
  const res = await storeAsset(db, storage, {
    clientId: input.clientId,
    bytes: input.bytes,
    declaredMime: input.mime,
    source: "upload",
    status: "approved",
    alt: input.alt ?? "",
    tags: input.tags ?? [],
    contentId: input.contentId ?? null,
    createdBy: actor.id,
  });
  if (res.created)
    await recordAuditEvent(db, {
      actor,
      action: "content.asset_uploaded",
      entity: "asset",
      entityId: res.row.id,
      clientId: input.clientId,
    });
  return res;
}

/** Copy an approved catalog photo into the library (the product source gives its storage key). */
export async function importProductImage(
  db: Database,
  storage: StorageDriver,
  actor: Actor,
  input: { clientId: string; productId: string; storageKey: string; alt: string },
) {
  humanOnly(actor, "assets.upload", input.clientId);
  if (!input.storageKey.startsWith(`clients/${input.clientId}/`))
    invalid("content.errors.imageOtherClient");
  // Only images of an approved product of this client, as the catalog lists them.
  const product = await productSource().get(db, input.clientId, input.productId);
  if (!product?.images.some((i) => i.storageKey === input.storageKey))
    invalid("content.errors.imageNotProduct");
  const chunks: Uint8Array[] = [];
  for await (const c of await storage.get(input.storageKey)) chunks.push(c as Uint8Array);
  const bytes = new Uint8Array(Buffer.concat(chunks));
  return storeAsset(db, storage, {
    clientId: input.clientId,
    bytes,
    declaredMime: "application/octet-stream",
    source: "product",
    status: "approved",
    alt: input.alt,
    productId: input.productId,
    createdBy: actor.id,
  });
}

/** Approve or reject a draft image (AI images must be approved before the carousel). */
export async function decideAsset(
  db: Database,
  actor: Actor,
  input: {
    clientId: string;
    id: string;
    decision: "approved" | "rejected";
    reason?: string;
    alt?: string;
  },
) {
  humanOnly(actor, input.decision === "approved" ? "approve" : "review", input.clientId);
  const reason = input.reason?.trim().slice(0, 500) ?? "";
  if (input.decision === "rejected" && reason.length < 3)
    invalid("content.errors.rejectReasonRequired");
  const [row] = await db
    .update(assets)
    .set({
      status: input.decision,
      decidedBy: actor.id,
      decidedAt: new Date(),
      rejectedReason: input.decision === "rejected" ? reason : null,
      ...(input.alt !== undefined ? { alt: input.alt.trim().slice(0, 300) } : {}),
    })
    .where(
      and(eq(assets.id, input.id), eq(assets.clientId, input.clientId), eq(assets.status, "draft")),
    )
    .returning();
  if (!row) conflict("content.errors.imageDecided");
  await recordAuditEvent(db, {
    actor,
    action: `content.asset_${input.decision}`,
    entity: "asset",
    entityId: row.id,
    clientId: input.clientId,
    meta: reason ? { reason } : {},
  });
  return row;
}

export async function updateAssetAlt(
  db: Database,
  actor: Actor,
  input: { clientId: string; id: string; alt: string },
) {
  humanOnly(actor, "edit_draft", input.clientId);
  const [row] = await db
    .update(assets)
    .set({ alt: input.alt.trim().slice(0, 300) })
    .where(and(eq(assets.id, input.id), eq(assets.clientId, input.clientId)))
    .returning({ id: assets.id });
  if (!row) notFound("content.errors.imageNotFound");
  return row;
}

export async function listAssets(
  db: Database,
  clientId: string,
  filter: { status?: AssetRow["status"][]; contentId?: string; limit?: number } = {},
) {
  return db
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.clientId, clientId),
        filter.status?.length ? inArray(assets.status, filter.status) : undefined,
        filter.contentId
          ? or(eq(assets.contentId, filter.contentId), isNull(assets.contentId))
          : undefined,
      ),
    )
    .orderBy(desc(assets.createdAt))
    .limit(Math.min(filter.limit ?? 200, 500));
}

export type CommercialUse = "verified" | "pending_verification" | "rejected";

/** Image providers whose terms an Admin checks before use with real clients. */
export const imageProviders = [
  "openai",
  "google",
  "openrouter",
  "higgsfield",
  "weave",
] as const satisfies readonly ProviderId[];
export type ImageProvider = (typeof imageProviders)[number];

export interface CommercialUseReview {
  status: CommercialUse;
  termsUrl: string | null;
  /** Day the terms were read, YYYY-MM-DD. */
  consultedOn: string | null;
  note: string | null;
  updatedBy: { id: string; name: string } | null;
  updatedAt: Date;
}

const reviewKey = (provider: ProviderId) => `ai.commercial_use.${provider}`;

const reviewValueSchema = z.object({
  status: z.enum(["verified", "pending_verification", "rejected"]),
  termsUrl: z.url().max(500).nullable().default(null),
  consultedOn: z.iso.date().nullable().default(null),
  note: z.string().max(500).nullable().default(null),
});

const reviewInputSchema = z
  .object({
    provider: z.enum(imageProviders),
    status: reviewValueSchema.shape.status,
    termsUrl: z
      .union([z.url("content.errors.termsUrlInvalid").max(500), z.literal("")])
      .optional()
      .transform((v) => v || null),
    consultedOn: z
      .union([z.iso.date("content.errors.dateInvalid"), z.literal("")])
      .optional()
      .transform((v) => v || null),
    note: z
      .string()
      .trim()
      .max(500, "content.errors.noteTooLong")
      .optional()
      .transform((v) => v || null),
  })
  .refine((v) => v.status !== "verified" || v.termsUrl, {
    message: "content.errors.verifiedNeedsTerms",
    path: ["termsUrl"],
  });

/** The agency's decision for each image provider configured from `.env`, if any. */
export async function getCommercialUseReviews(
  db: Executor,
): Promise<Map<ImageProvider, CommercialUseReview>> {
  const rows = await db
    .select({
      key: appSettings.key,
      value: appSettings.value,
      updatedAt: appSettings.updatedAt,
      userId: users.id,
      userName: users.name,
    })
    .from(appSettings)
    .leftJoin(users, eq(users.id, appSettings.updatedBy))
    .where(inArray(appSettings.key, imageProviders.map(reviewKey)));
  const out = new Map<ImageProvider, CommercialUseReview>();
  for (const p of imageProviders) {
    const row = rows.find((r) => r.key === reviewKey(p));
    const value = row ? reviewValueSchema.safeParse(row.value) : null;
    if (!row || !value?.success) continue;
    out.set(p, {
      ...value.data,
      updatedBy: row.userId ? { id: row.userId, name: row.userName ?? "" } : null,
      updatedAt: row.updatedAt,
    });
  }
  return out;
}

/** An Admin records the commercial-use status of an image provider (page “AI providers”). */
export async function setCommercialUse(db: Database, actor: Actor, input: unknown): Promise<void> {
  humanOnly(actor, "ai.providers.manage");
  const { provider, ...value } = parseOrThrow(reviewInputSchema, input);
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, reviewKey(provider)));
    await tx
      .insert(appSettings)
      .values({ key: reviewKey(provider), value, updatedBy: actor.id })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedBy: actor.id, updatedAt: new Date() },
      });
    await recordAuditEvent(tx, {
      actor,
      action: "commercial_use_status_changed",
      entity: "ai_provider",
      entityId: provider,
      meta: {
        status: value.status,
        before: (before?.value as { status?: string } | undefined)?.status ?? null,
      },
    });
  });
}

/**
 * Commercial use of an image provider for a client: a BYOK connection of the client wins
 * over the agency's (ai_connections.commercial_use_status); a provider configured only
 * through environment keys uses the Admin's decision, else counts as not yet verified.
 * `rejected` blocks generation.
 */
export async function commercialUseFor(
  db: Executor,
  provider: ProviderId,
  clientId: string,
): Promise<CommercialUse> {
  const rows = await db
    .select({ scope: aiConnections.scope, status: aiConnections.commercialUseStatus })
    .from(aiConnections)
    .where(
      and(
        eq(aiConnections.provider, provider),
        eq(aiConnections.status, "active"),
        or(
          and(eq(aiConnections.scope, "client"), eq(aiConnections.scopeId, clientId)),
          eq(aiConnections.scope, "agency"),
        ),
      ),
    )
    .orderBy(sql`case when ${aiConnections.scope} = 'client' then 0 else 1 end`);
  if (rows[0]) return rows[0].status;
  const [review] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, reviewKey(provider)));
  const parsed = review ? reviewValueSchema.safeParse(review.value) : null;
  return parsed?.success ? parsed.data.status : "pending_verification";
}

export type AssetRights = {
  basis: AssetRightsBasis;
  /** Licence reference or where the right comes from; required for a licensed image. */
  note: string;
  confirmedBy: string;
  confirmedAt: string;
};

const rightsInput = z.object({
  clientId: z.uuid(),
  id: z.uuid(),
  basis: z.enum(assetRightsBases),
  note: z.string().trim().max(500).default(""),
});

/** Parses the stored `rights` of an image; null when absent or malformed. */
export function readAssetRights(value: unknown): AssetRights | null {
  const v = value as Partial<AssetRights> | null;
  if (!v || typeof v !== "object" || !assetRightsBases.includes(v.basis as AssetRightsBasis))
    return null;
  return {
    basis: v.basis as AssetRightsBasis,
    note: typeof v.note === "string" ? v.note : "",
    confirmedBy: typeof v.confirmedBy === "string" ? v.confirmedBy : "",
    confirmedAt: typeof v.confirmedAt === "string" ? v.confirmedAt : "",
  };
}

/**
 * Commercial-use status of an image: AI images follow the provider review recorded at
 * generation, uploads need a person to confirm the rights, product photos come from the
 * client's own catalog (null: nothing to verify).
 */
export function assetCommercialUse(a: {
  source: AssetRow["source"];
  generation: unknown;
  rights: unknown;
}): CommercialUse | null {
  if (a.source === "ai") {
    const g = (a.generation ?? {}) as { commercialUse?: string };
    return g.commercialUse === "verified" || g.commercialUse === "rejected"
      ? g.commercialUse
      : "pending_verification";
  }
  if (a.source === "upload") return readAssetRights(a.rights) ? "verified" : "pending_verification";
  return null;
}

/** A person confirms they may use an uploaded image commercially (and says on what basis). */
export async function confirmAssetRights(db: Database, actor: Actor, input: unknown) {
  const i = parseOrThrow(rightsInput, input);
  humanOnly(actor, "assets.upload", i.clientId);
  if (i.basis === "licensed" && i.note.length < 3) invalid("content.errors.rightsNoteRequired");
  const rights: AssetRights = {
    basis: i.basis,
    note: i.note,
    confirmedBy: actor.id,
    confirmedAt: new Date().toISOString(),
  };
  const [row] = await db
    .update(assets)
    .set({ rights })
    .where(and(eq(assets.id, i.id), eq(assets.clientId, i.clientId), eq(assets.source, "upload")))
    .returning({ id: assets.id });
  if (!row) notFound("content.errors.imageNotFound");
  await recordAuditEvent(db, {
    actor,
    action: "content.asset_rights_confirmed",
    entity: "asset",
    entityId: row.id,
    clientId: i.clientId,
    meta: { basis: i.basis },
  });
  return row;
}
