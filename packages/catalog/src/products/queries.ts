import type { ProductStatus } from "@forgecy/core";
import {
  and,
  asc,
  auditEvents,
  desc,
  eq,
  inArray,
  ne,
  or,
  productFieldProposals,
  productImages,
  productImportFiles,
  productImportItems,
  productImports,
  products,
  sql,
  users,
} from "@forgecy/db";
import { ilike, type SQL } from "drizzle-orm";
import { completenessOf, type Completeness } from "./completeness";
import type { DbLike } from "../db";
import type { ProductFields } from "./fields";
import { describeSource, type SourceRef } from "./meta";
import { rowToFields, type ProductImageRow, type ProductRow } from "./products";

export const PAGE_SIZE = 50;

export interface CatalogFilters {
  q?: string;
  status?: ProductStatus[];
  category?: string;
  source?: SourceRef["kind"] | "zip";
  completeness?: Completeness;
  importId?: string;
  sort?: "name" | "updated" | "status";
  page?: number;
}

export interface CatalogRow {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  status: ProductStatus;
  revision: number;
  proposedByAgent: boolean;
  completeness: ReturnType<typeof completenessOf>;
  /** English description of the origin (CSV export); `origin` lets the interface word it. */
  source: string;
  sourceKind: string;
  origin: SourceRef | null;
  primaryImage: Pick<ProductImageRow, "id" | "storageKey" | "status" | "alt"> | null;
  openProposals: number;
  updatedAt: Date;
  updatedByName: string | null;
  sensitivePending: boolean;
  fields: ProductFields;
}

/** Default status filter: everything except archived and rejected. */
export const DEFAULT_STATUSES: ProductStatus[] = ["draft", "proposed", "approved"];

export async function listProducts(db: DbLike, clientId: string, f: CatalogFilters) {
  const conds: SQL[] = [eq(products.clientId, clientId)];
  conds.push(inArray(products.status, f.status?.length ? f.status : DEFAULT_STATUSES));
  if (f.q?.trim()) {
    const q = `%${f.q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    conds.push(
      or(
        ilike(products.name, q),
        ilike(products.sku, q),
        sql`array_to_string(${products.tags}, ' ') ilike ${q}`,
      )!,
    );
  }
  if (f.category) conds.push(eq(products.category, f.category));
  if (f.importId) conds.push(eq(products.sourceImportId, f.importId));
  if (f.source) {
    if (f.source === "zip") conds.push(sql`${products.origin}->>'kind' in ('image','text')`);
    else if (f.source === "csv") conds.push(sql`${products.origin}->>'kind' in ('csv','xlsx')`);
    else conds.push(sql`${products.origin}->>'kind' = ${f.source}`);
  }
  const order =
    f.sort === "name"
      ? [asc(products.name)]
      : f.sort === "status"
        ? [asc(products.status), asc(products.name)]
        : [desc(products.updatedAt)];
  const rows = await db
    .select({ p: products, updatedByName: users.name })
    .from(products)
    .leftJoin(users, eq(users.id, products.updatedBy))
    .where(and(...conds))
    .orderBy(...order)
    .limit(2000);
  const ids = rows.map((r) => r.p.id);
  const [imgs, props] = ids.length
    ? await Promise.all([
        db
          .select()
          .from(productImages)
          .where(inArray(productImages.productId, ids))
          .orderBy(desc(productImages.isPrimary), asc(productImages.position)),
        db
          .select({ productId: productFieldProposals.productId, n: sql<number>`count(*)::int` })
          .from(productFieldProposals)
          .where(
            and(
              inArray(productFieldProposals.productId, ids),
              eq(productFieldProposals.status, "proposed"),
            ),
          )
          .groupBy(productFieldProposals.productId),
      ])
    : [[], []];
  const imagesBy = new Map<string, ProductImageRow[]>();
  for (const i of imgs) imagesBy.set(i.productId, [...(imagesBy.get(i.productId) ?? []), i]);
  const propsBy = new Map(props.map((p) => [p.productId, p.n]));
  let list: CatalogRow[] = rows.map(({ p, updatedByName }) =>
    toCatalogRow(p, imagesBy.get(p.id) ?? [], propsBy.get(p.id) ?? 0, updatedByName),
  );
  if (f.completeness) list = list.filter((r) => r.completeness.level === f.completeness);
  const total = list.length;
  const page = Math.max(1, f.page ?? 1);
  return {
    rows: list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

function toCatalogRow(
  p: ProductRow,
  images: ProductImageRow[],
  openProposals: number,
  updatedByName: string | null,
): CatalogRow {
  const fields = rowToFields(p);
  const origin = p.origin as unknown as SourceRef;
  const meta = p.fieldMeta as Record<string, { sensitive?: string[]; acceptedBy?: string }>;
  const primary = images.find((i) => i.isPrimary) ?? images[0] ?? null;
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    category: p.category,
    status: p.status,
    revision: p.revision,
    proposedByAgent: p.proposedByAgent,
    completeness: completenessOf(fields, images.length),
    source: origin?.kind ? describeSource(origin) : "—",
    sourceKind: origin?.kind ?? "manual",
    origin: origin?.kind ? origin : null,
    primaryImage: primary
      ? { id: primary.id, storageKey: primary.storageKey, status: primary.status, alt: primary.alt }
      : null,
    openProposals,
    updatedAt: p.updatedAt,
    updatedByName,
    sensitivePending: Object.values(meta ?? {}).some((m) => m?.sensitive?.length && !m.acceptedBy),
    fields,
  };
}

export async function statusCounts(db: DbLike, clientId: string) {
  const rows = await db
    .select({ status: products.status, n: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.clientId, clientId))
    .groupBy(products.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<
    Record<ProductStatus, number>
  >;
  const total = (by.draft ?? 0) + (by.proposed ?? 0) + (by.approved ?? 0);
  return {
    total,
    approved: by.approved ?? 0,
    proposed: by.proposed ?? 0,
    draft: by.draft ?? 0,
    rejected: by.rejected ?? 0,
    archived: by.archived ?? 0,
  };
}

export async function categories(db: DbLike, clientId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ c: products.category })
    .from(products)
    .where(and(eq(products.clientId, clientId), ne(products.status, "archived")))
    .orderBy(asc(products.category));
  return rows.map((r) => r.c).filter((c): c is string => !!c);
}

/** Approved products of a client, for strategy and carousel briefs (only `approved`). */
export async function approvedProducts(db: DbLike, clientId: string) {
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.clientId, clientId), eq(products.status, "approved")))
    .orderBy(asc(products.name));
  const ids = rows.map((r) => r.id);
  const imgs = ids.length
    ? await db
        .select()
        .from(productImages)
        .where(and(inArray(productImages.productId, ids), eq(productImages.status, "approved")))
    : [];
  return rows.map((r) => ({
    id: r.id,
    fields: rowToFields(r),
    images: imgs.filter((i) => i.productId === r.id),
    updatedAt: r.updatedAt,
  }));
}

export async function productDetail(db: DbLike, clientId: string, productId: string) {
  const [p] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.clientId, clientId)));
  if (!p) return null;
  const [images, proposals, history] = await Promise.all([
    db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, p.id))
      .orderBy(desc(productImages.isPrimary), asc(productImages.position)),
    db
      .select({ pr: productFieldProposals, decidedByName: users.name })
      .from(productFieldProposals)
      .leftJoin(users, eq(users.id, productFieldProposals.decidedBy))
      .where(eq(productFieldProposals.productId, p.id))
      .orderBy(desc(productFieldProposals.createdAt))
      .limit(200),
    db
      .select({ e: auditEvents, userName: users.name })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(and(eq(auditEvents.entity, "product"), eq(auditEvents.entityId, p.id)))
      .orderBy(desc(auditEvents.at))
      .limit(200),
  ]);
  const [sourceImport] = p.sourceImportId
    ? await db.select().from(productImports).where(eq(productImports.id, p.sourceImportId))
    : [];
  const pdfSources = sourceImport
    ? await db
        .select()
        .from(productImportFiles)
        .where(
          and(
            eq(productImportFiles.importId, sourceImport.id),
            eq(productImportFiles.kind, "pdf"),
            eq(productImportFiles.valid, true),
          ),
        )
    : [];
  const userIds = [p.createdBy, p.updatedBy, p.approvedBy].filter((x): x is string => !!x);
  const names = userIds.length
    ? await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, userIds))
    : [];
  return {
    product: p,
    fields: rowToFields(p),
    images,
    proposals,
    history,
    sourceImport: sourceImport ?? null,
    pdfSources,
    userNames: Object.fromEntries(names.map((n) => [n.id, n.name])),
  };
}

export async function importReview(db: DbLike, clientId: string, importId: string) {
  const [imp] = await db
    .select()
    .from(productImports)
    .where(and(eq(productImports.id, importId), eq(productImports.clientId, clientId)));
  if (!imp) return null;
  const [items, files] = await Promise.all([
    db
      .select()
      .from(productImportItems)
      .where(eq(productImportItems.importId, imp.id))
      .orderBy(asc(productImportItems.position)),
    db
      .select()
      .from(productImportFiles)
      .where(eq(productImportFiles.importId, imp.id))
      .orderBy(asc(productImportFiles.path)),
  ]);
  const matchIds = [...new Set(items.map((i) => i.matchProductId).filter((x): x is string => !!x))];
  const matches = matchIds.length
    ? await db.select().from(products).where(inArray(products.id, matchIds))
    : [];
  const approverIds = [
    ...new Set(matches.map((m) => m.approvedBy).filter((x): x is string => !!x)),
  ];
  const approvers = approverIds.length
    ? await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, approverIds))
    : [];
  return {
    imp,
    items,
    files,
    matches: new Map(matches.map((m) => [m.id, m])),
    approvers: Object.fromEntries(approvers.map((a) => [a.id, a.name])),
  };
}
