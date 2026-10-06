import { assertCan, ForgecyError, type ConfidenceLevel, type ProductStatus } from "@forgecy/core";
import {
  and,
  eq,
  inArray,
  productFieldProposals,
  productImages,
  products,
  recordAuditEvent,
  sql,
  type Database,
} from "@forgecy/db";
import { completenessOf } from "./completeness";
import type { ActingUser, DbLike } from "./db";
import {
  emptyFields,
  fieldDef,
  fieldKeys,
  isEmptyValue,
  productFieldsSchema,
  sameValue,
  sanitizeDraft,
  type FieldKey,
  type ProductDraft,
  type ProductFields,
} from "./fields";
import type { FieldMeta, FieldMetaMap, SourceRef } from "./meta";
import { claimLabels, sensitiveFields } from "./sensitive";

export type ProductRow = typeof products.$inferSelect;
export type ProductImageRow = typeof productImages.$inferSelect;
export type FieldProposalRow = typeof productFieldProposals.$inferSelect;

const COLUMN_KEYS = new Set<FieldKey>(["name", "sku", "category", "tags"]);

/** All fields of a product, columns and `details` together. */
export function rowToFields(
  row: Pick<ProductRow, "name" | "sku" | "category" | "tags" | "details">,
): ProductFields {
  const details = (row.details ?? {}) as Partial<ProductFields>;
  return {
    ...emptyFields(),
    ...details,
    name: row.name,
    sku: row.sku ?? "",
    category: row.category ?? "",
    tags: row.tags ?? [],
  };
}

export function fieldsToColumns(fields: ProductFields) {
  const details: Record<string, unknown> = {};
  for (const key of fieldKeys)
    if (!COLUMN_KEYS.has(key) && !isEmptyValue(fields[key])) details[key] = fields[key];
  return {
    name: fields.name,
    sku: fields.sku || null,
    category: fields.category || null,
    tags: fields.tags,
    details,
  };
}

export function metaOf(row: Pick<ProductRow, "fieldMeta">): FieldMetaMap {
  return (row.fieldMeta ?? {}) as FieldMetaMap;
}

/** Sensitive fields not yet accepted by a person. */
export function pendingSensitive(fields: ProductDraft, meta: FieldMetaMap): FieldKey[] {
  return fieldKeys.filter((k) => {
    const m = meta[k];
    return !isEmptyValue(fields[k]) && m?.sensitive?.length && !m.acceptedBy;
  });
}

/**
 * Why a product cannot be approved yet (UXA-P6-11): name, category and short
 * description present, no sensitive field waiting. Empty list = approvable.
 */
export function approvalBlockers(fields: ProductDraft, meta: FieldMetaMap): string[] {
  const out: string[] = [];
  const missing = (["name", "category", "shortDescription"] as const).filter((k) =>
    isEmptyValue(fields[k]),
  );
  if (missing.length)
    out.push(`Completa ${missing.map((k) => fieldDef(k).label.toLowerCase()).join(", ")}`);
  for (const k of pendingSensitive(fields, meta)) {
    const kind = meta[k]!.sensitive![0]!;
    out.push(`Accetta prima il campo sensibile "${fieldDef(k).label}" (${claimLabels[kind]})`);
  }
  return out;
}

/** Recompute claim flags after a change; a person typing a value accepts it. */
export function withSensitivity(
  fields: ProductDraft,
  meta: FieldMetaMap,
  changed: FieldKey[],
  acceptedBy?: string,
): FieldMetaMap {
  const flags = sensitiveFields(fields);
  const out: FieldMetaMap = { ...meta };
  for (const k of changed) {
    const m = out[k];
    if (!m) continue;
    const kinds = flags[k];
    if (kinds?.length) {
      out[k] = { ...m, sensitive: kinds };
      if (acceptedBy) out[k] = { ...out[k]!, acceptedBy, acceptedAt: new Date().toISOString() };
      else {
        const { acceptedBy: _a, acceptedAt: _b, acceptNote: _c, ...rest } = out[k]!;
        out[k] = rest;
      }
    } else {
      const { sensitive: _s, acceptedBy: _a, acceptedAt: _b, acceptNote: _c, ...rest } = m;
      out[k] = rest;
    }
  }
  return out;
}

export async function loadProduct(
  db: DbLike,
  clientId: string,
  productId: string,
): Promise<ProductRow> {
  const [row] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.clientId, clientId)));
  if (!row) throw new ForgecyError("not_found", "Prodotto non trovato");
  return row;
}

function manualSource(user: ActingUser): SourceRef {
  return { kind: "manual", userId: user.id, userName: user.name };
}

export interface CreateProductInput {
  clientId: string;
  name: string;
  sku?: string;
  category?: string;
}

/** "Aggiungi prodotto": a draft typed by a person. */
export async function createProduct(
  db: Database,
  user: ActingUser,
  input: CreateProductInput,
): Promise<ProductRow> {
  assertCan(user.actor, "products.manage", input.clientId);
  const draft = sanitizeDraft({
    name: input.name,
    sku: input.sku ?? "",
    category: input.category ?? "",
  });
  if (!draft.name) throw new ForgecyError("validation", "Scrivi il nome del prodotto");
  const fields = { ...emptyFields(), ...draft };
  const now = new Date().toISOString();
  const meta: FieldMetaMap = {};
  for (const k of fieldKeys)
    if (!isEmptyValue(fields[k]))
      meta[k] = {
        truth: "proposed",
        source: manualSource(user),
        confidence: "high",
        updatedAt: now,
      };
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(products)
      .values({
        clientId: input.clientId,
        status: "draft",
        ...fieldsToColumns(fields),
        fieldMeta: meta as Record<string, unknown>,
        origin: manualSource(user) as unknown as Record<string, unknown>,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    await recordAuditEvent(tx, {
      actor: user.actor,
      action: "product.create",
      entity: "product",
      entityId: row!.id,
      clientId: input.clientId,
    });
    return row!;
  });
}

/** Optimistic concurrency: a stale revision means someone else saved first. */
function revisionConflict(): ForgecyError {
  return new ForgecyError(
    "conflict",
    "Un'altra persona ha modificato questo prodotto mentre lo stavi modificando. Ricarica per vedere le differenze.",
    { code: "CONFLICT-DRAFT-REV" },
  );
}

/**
 * Edit fields typed by a person. Approved products change immediately and keep
 * their status; the history records before and after.
 */
export async function updateProductFields(
  db: Database,
  user: ActingUser,
  input: { clientId: string; productId: string; revision: number; patch: ProductDraft },
): Promise<ProductRow> {
  assertCan(user.actor, "products.manage", input.clientId);
  return db.transaction(async (tx) => {
    const row = await loadProduct(tx, input.clientId, input.productId);
    if (row.revision !== input.revision) throw revisionConflict();
    if (row.status === "archived")
      throw new ForgecyError("conflict", "Ripristina il prodotto prima di modificarlo");
    const before = rowToFields(row);
    const after: ProductFields = { ...before };
    const changed: FieldKey[] = [];
    for (const k of Object.keys(input.patch) as FieldKey[]) {
      if (!fieldKeys.includes(k)) continue;
      const parsed = productFieldsSchema.shape[k].safeParse(input.patch[k]);
      if (!parsed.success)
        throw new ForgecyError(
          "validation",
          `${fieldDef(k).label}: ${parsed.error.issues[0]?.message ?? "valore non valido"}`,
        );
      if (sameValue(before[k], parsed.data)) continue;
      (after as Record<string, unknown>)[k] = parsed.data;
      changed.push(k);
    }
    if (!after.name) throw new ForgecyError("validation", "Il nome è obbligatorio");
    if (changed.length === 0) return row;
    const now = new Date().toISOString();
    let meta = { ...metaOf(row) };
    for (const k of changed)
      meta[k] = {
        truth: row.status === "approved" ? "approved" : "proposed",
        source: manualSource(user),
        confidence: "high",
        updatedAt: now,
      };
    meta = withSensitivity(after, meta, changed, user.id);
    const [updated] = await tx
      .update(products)
      .set({
        ...fieldsToColumns(after),
        fieldMeta: meta as Record<string, unknown>,
        updatedBy: user.id,
        revision: sql`${products.revision} + 1`,
      })
      .where(and(eq(products.id, row.id), eq(products.revision, input.revision)))
      .returning();
    if (!updated) throw revisionConflict();
    await recordAuditEvent(tx, {
      actor: user.actor,
      action: "product.update",
      entity: "product",
      entityId: row.id,
      clientId: input.clientId,
      meta: {
        fields: changed,
        before: Object.fromEntries(changed.map((k) => [k, before[k]])),
        after: Object.fromEntries(changed.map((k) => [k, after[k]])),
        wasApproved: row.status === "approved",
      },
    });
    return updated;
  });
}

/** Accept a sensitive field one by one; at Low confidence a note is mandatory. */
export async function acceptSensitiveField(
  db: Database,
  user: ActingUser,
  input: { clientId: string; productId: string; field: FieldKey; note?: string },
): Promise<void> {
  assertCan(user.actor, "approve", input.clientId);
  await db.transaction(async (tx) => {
    const row = await loadProduct(tx, input.clientId, input.productId);
    const meta = metaOf(row);
    const m = meta[input.field];
    if (!m?.sensitive?.length) throw new ForgecyError("validation", "Il campo non è sensibile");
    const note = input.note?.trim();
    if (m.confidence === "low" && !note)
      throw new ForgecyError(
        "validation",
        "Confidenza bassa: scrivi una nota per accettare il campo",
      );
    meta[input.field] = {
      ...m,
      acceptedBy: user.id,
      acceptedAt: new Date().toISOString(),
      ...(note ? { acceptNote: note } : {}),
    };
    await tx
      .update(products)
      .set({
        fieldMeta: meta as Record<string, unknown>,
        revision: sql`${products.revision} + 1`,
        updatedBy: user.id,
      })
      .where(eq(products.id, row.id));
    await recordAuditEvent(tx, {
      actor: user.actor,
      action: "product.sensitive_accept",
      entity: "product",
      entityId: row.id,
      clientId: input.clientId,
      meta: { field: input.field, confidence: m.confidence, note: note ?? null },
    });
  });
}

const TRANSITIONS: Record<
  string,
  {
    from: ProductStatus[];
    to: ProductStatus;
    permission: "approve" | "archive" | "review" | "products.manage";
  }
> = {
  approve: { from: ["draft", "proposed"], to: "approved", permission: "approve" },
  reject: { from: ["draft", "proposed"], to: "rejected", permission: "review" },
  archive: {
    from: ["draft", "proposed", "approved", "rejected"],
    to: "archived",
    permission: "archive",
  },
  to_draft: { from: ["rejected"], to: "draft", permission: "products.manage" },
  restore: { from: ["archived"], to: "draft", permission: "archive" },
};
export type ProductTransition = keyof typeof TRANSITIONS;

export interface TransitionResult {
  done: string[];
  /** Products left out, with the reason ("campi sensibili", "modificato da un'altra persona"...). */
  skipped: Array<{ id: string; name: string; reason: string; code?: string }>;
}

/**
 * Status changes, one product or in bulk. Bulk approval excludes products with
 * sensitive fields waiting or missing required fields, and says so. Agents never
 * reach this: `approve`, `review` and `archive` are not agent permissions.
 */
export async function transitionProducts(
  db: Database,
  user: ActingUser,
  input: {
    clientId: string;
    ids: string[];
    action: ProductTransition;
    note?: string;
    /** Single-product actions pass the revision they saw. */
    revisions?: Record<string, number>;
  },
): Promise<TransitionResult> {
  const t = TRANSITIONS[input.action];
  if (!t) throw new ForgecyError("validation", "Azione non valida");
  assertCan(user.actor, t.permission, input.clientId);
  const ids = [...new Set(input.ids)].slice(0, 1000);
  if (ids.length === 0) return { done: [], skipped: [] };
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(products)
      .where(and(eq(products.clientId, input.clientId), inArray(products.id, ids)))
      .for("update");
    const result: TransitionResult = { done: [], skipped: [] };
    for (const row of rows) {
      const expected = input.revisions?.[row.id];
      if (expected !== undefined && expected !== row.revision) {
        result.skipped.push({
          id: row.id,
          name: row.name,
          reason: "modificato da un'altra persona nel frattempo",
          code: "CONFLICT-DRAFT-REV",
        });
        continue;
      }
      if (!t.from.includes(row.status)) {
        result.skipped.push({
          id: row.id,
          name: row.name,
          reason: "stato non compatibile",
          code: "CONFLICT-STATE",
        });
        continue;
      }
      const fields = rowToFields(row);
      let meta = metaOf(row);
      const set: Partial<typeof products.$inferInsert> = {
        status: t.to,
        updatedBy: user.id,
        revision: sql`${products.revision} + 1` as unknown as number,
      };
      if (input.action === "approve") {
        const blockers = approvalBlockers(fields, meta);
        if (blockers.length) {
          result.skipped.push({
            id: row.id,
            name: row.name,
            reason: pendingSensitive(fields, meta).length
              ? "campi sensibili da accettare uno per uno"
              : blockers[0]!,
          });
          continue;
        }
        meta = Object.fromEntries(
          Object.entries(meta).map(([k, m]) => [k, { ...m, truth: "approved" } as FieldMeta]),
        );
        Object.assign(set, {
          fieldMeta: meta,
          approvedBy: user.id,
          approvedAt: new Date(),
          approvalNote: input.note?.trim() || null,
          rejectedReason: null,
        });
      }
      if (input.action === "reject") set.rejectedReason = input.note?.trim() || null;
      if (input.action === "archive") set.archivedAt = new Date();
      if (input.action === "restore") {
        set.archivedAt = null;
        if (row.approvedAt) set.status = "approved";
      }
      await tx.update(products).set(set).where(eq(products.id, row.id));
      await recordAuditEvent(tx, {
        actor: user.actor,
        action: `product.${input.action}`,
        entity: "product",
        entityId: row.id,
        clientId: input.clientId,
        meta: {
          from: row.status,
          to: set.status ?? t.to,
          ...(input.note ? { note: input.note } : {}),
        },
      });
      result.done.push(row.id);
    }
    return result;
  });
}

/**
 * Permanent delete, only with the product name typed. Images stay in storage
 * (they may be used elsewhere); the rows linking them go.
 */
export async function deleteProduct(
  db: Database,
  user: ActingUser,
  input: { clientId: string; productId: string; typedName: string },
): Promise<void> {
  assertCan(user.actor, "archive", input.clientId);
  await db.transaction(async (tx) => {
    const row = await loadProduct(tx, input.clientId, input.productId);
    if (input.typedName.trim() !== row.name.trim())
      throw new ForgecyError("validation", "Il nome digitato non corrisponde");
    await tx.delete(products).where(eq(products.id, row.id));
    await recordAuditEvent(tx, {
      actor: user.actor,
      action: "product.delete",
      entity: "product",
      entityId: row.id,
      clientId: input.clientId,
      meta: { name: row.name, sku: row.sku },
    });
  });
}

/** Duplicate as a new draft (manual source, no images). */
export async function duplicateProduct(
  db: Database,
  user: ActingUser,
  input: { clientId: string; productId: string },
): Promise<ProductRow> {
  assertCan(user.actor, "products.manage", input.clientId);
  const row = await loadProduct(db, input.clientId, input.productId);
  const fields = { ...rowToFields(row), name: `${row.name} (copia)`.slice(0, 200), sku: "" };
  const meta: FieldMetaMap = {};
  for (const k of fieldKeys)
    if (!isEmptyValue(fields[k]))
      meta[k] = { truth: "proposed", source: manualSource(user), confidence: "high" };
  return db.transaction(async (tx) => {
    const [copy] = await tx
      .insert(products)
      .values({
        clientId: input.clientId,
        status: "draft",
        ...fieldsToColumns(fields),
        fieldMeta: withSensitivity(fields, meta, fieldKeys, user.id) as Record<string, unknown>,
        origin: manualSource(user) as unknown as Record<string, unknown>,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    await recordAuditEvent(tx, {
      actor: user.actor,
      action: "product.duplicate",
      entity: "product",
      entityId: copy!.id,
      clientId: input.clientId,
      meta: { from: row.id },
    });
    return copy!;
  });
}

// ---- Field proposals ----

/**
 * Open a proposal on a product field (import merge, conflicts left for later,
 * agents). Proposals never touch the value until a person accepts them.
 */
export async function proposeField(
  db: DbLike,
  input: {
    clientId: string;
    productId: string;
    field: FieldKey;
    currentValue: unknown;
    proposedValue: unknown;
    meta: FieldMeta;
    importId?: string | null;
    proposedBy: string;
  },
): Promise<void> {
  // One open proposal per field and value: re-importing the same file doesn't stack them.
  const open = await db
    .select({ id: productFieldProposals.id, value: productFieldProposals.proposedValue })
    .from(productFieldProposals)
    .where(
      and(
        eq(productFieldProposals.productId, input.productId),
        eq(productFieldProposals.field, input.field),
        eq(productFieldProposals.status, "proposed"),
      ),
    );
  if (open.some((p) => sameValue(p.value, input.proposedValue))) return;
  await db.insert(productFieldProposals).values({
    clientId: input.clientId,
    productId: input.productId,
    field: input.field,
    currentValue: input.currentValue ?? null,
    proposedValue: input.proposedValue,
    meta: input.meta as unknown as Record<string, unknown>,
    importId: input.importId ?? null,
    proposedBy: input.proposedBy,
  });
}

/** Accept (optionally edited) or reject a field proposal. */
export async function decideFieldProposal(
  db: Database,
  user: ActingUser,
  input: {
    clientId: string;
    proposalId: string;
    decision: "accept" | "reject";
    editedValue?: unknown;
    note?: string;
  },
): Promise<void> {
  assertCan(user.actor, input.decision === "accept" ? "approve" : "review", input.clientId);
  await db.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(productFieldProposals)
      .where(
        and(
          eq(productFieldProposals.id, input.proposalId),
          eq(productFieldProposals.clientId, input.clientId),
        ),
      )
      .for("update");
    if (!p) throw new ForgecyError("not_found", "Proposta non trovata");
    if (p.status !== "proposed")
      throw new ForgecyError("conflict", "Un'altra persona ha già deciso questa proposta", {
        code: "CONFLICT-STATE",
      });
    const field = p.field as FieldKey;
    const proposalMeta = p.meta as unknown as FieldMeta;
    if (input.decision === "accept") {
      const row = await loadProduct(tx, input.clientId, p.productId);
      const value = input.editedValue !== undefined ? input.editedValue : p.proposedValue;
      const parsed = productFieldsSchema.shape[field].safeParse(value);
      if (!parsed.success) throw new ForgecyError("validation", "Valore non valido");
      const fields = { ...rowToFields(row), [field]: parsed.data } as ProductFields;
      const edited = input.editedValue !== undefined;
      const flags = sensitiveFields(fields)[field];
      const note = input.note?.trim();
      if (flags?.length && proposalMeta.confidence === "low" && !note && !edited)
        throw new ForgecyError(
          "validation",
          "Campo sensibile a confidenza bassa: scrivi una nota per accettarlo",
        );
      const meta = metaOf(row);
      meta[field] = {
        ...(edited
          ? { source: manualSource(user), confidence: "high" as ConfidenceLevel }
          : proposalMeta),
        truth: row.status === "approved" ? "approved" : "proposed",
        updatedAt: new Date().toISOString(),
        ...(flags?.length
          ? {
              sensitive: flags,
              acceptedBy: user.id,
              acceptedAt: new Date().toISOString(),
              ...(note ? { acceptNote: note } : {}),
            }
          : {}),
      } as FieldMeta;
      await tx
        .update(products)
        .set({
          ...fieldsToColumns(fields),
          fieldMeta: meta as Record<string, unknown>,
          updatedBy: user.id,
          revision: sql`${products.revision} + 1`,
        })
        .where(eq(products.id, row.id));
      await recordAuditEvent(tx, {
        actor: user.actor,
        action: "product.field_proposal_accepted",
        entity: "product",
        entityId: row.id,
        clientId: input.clientId,
        meta: {
          field,
          proposalId: p.id,
          before: rowToFields(row)[field],
          after: parsed.data,
          edited,
        },
      });
    } else {
      await recordAuditEvent(tx, {
        actor: user.actor,
        action: "product.field_proposal_rejected",
        entity: "product",
        entityId: p.productId,
        clientId: input.clientId,
        meta: { field, proposalId: p.id },
      });
    }
    await tx
      .update(productFieldProposals)
      .set({
        status: input.decision === "accept" ? "accepted" : "rejected",
        decidedBy: user.id,
        decidedAt: new Date(),
        note: input.note?.trim() || null,
      })
      .where(eq(productFieldProposals.id, p.id));
  });
}

// ---- Images ----

export async function updateProductImage(
  db: Database,
  user: ActingUser,
  input: {
    clientId: string;
    imageId: string;
    action: "primary" | "unlink" | "approve" | "alt";
    alt?: string;
  },
): Promise<void> {
  assertCan(user.actor, input.action === "approve" ? "approve" : "products.manage", input.clientId);
  await db.transaction(async (tx) => {
    const [img] = await tx
      .select()
      .from(productImages)
      .where(and(eq(productImages.id, input.imageId), eq(productImages.clientId, input.clientId)));
    if (!img) throw new ForgecyError("not_found", "Immagine non trovata");
    if (input.action === "primary") {
      await tx
        .update(productImages)
        .set({ isPrimary: false })
        .where(eq(productImages.productId, img.productId));
      await tx.update(productImages).set({ isPrimary: true }).where(eq(productImages.id, img.id));
    } else if (input.action === "unlink") {
      await tx.delete(productImages).where(eq(productImages.id, img.id));
      if (img.isPrimary) {
        const [next] = await tx
          .select({ id: productImages.id })
          .from(productImages)
          .where(eq(productImages.productId, img.productId))
          .orderBy(productImages.position)
          .limit(1);
        if (next)
          await tx
            .update(productImages)
            .set({ isPrimary: true })
            .where(eq(productImages.id, next.id));
      }
    } else if (input.action === "approve") {
      await tx
        .update(productImages)
        .set({ status: "approved", approvedBy: user.id })
        .where(eq(productImages.id, img.id));
    } else {
      await tx
        .update(productImages)
        .set({ alt: (input.alt ?? "").trim().slice(0, 300) || null })
        .where(eq(productImages.id, img.id));
    }
    await recordAuditEvent(tx, {
      actor: user.actor,
      action: `product.image_${input.action}`,
      entity: "product",
      entityId: img.productId,
      clientId: input.clientId,
      meta: { imageId: img.id, fileName: img.fileName },
    });
  });
}

/** Attach stored images to a product; the first one becomes primary if none is. */
export async function attachImages(
  db: DbLike,
  input: {
    clientId: string;
    productId: string;
    images: Array<{
      storageKey: string;
      sha256: string;
      mime: string;
      fileName: string;
      matchMethod: (typeof productImages.$inferInsert)["matchMethod"];
      confidence: ConfidenceLevel;
      sourceImportId?: string | null;
    }>;
    createdBy?: string | null;
  },
): Promise<number> {
  if (input.images.length === 0) return 0;
  const existing = await db
    .select({
      sha: productImages.sha256,
      primary: productImages.isPrimary,
      position: productImages.position,
    })
    .from(productImages)
    .where(eq(productImages.productId, input.productId));
  const seen = new Set(existing.map((e) => e.sha));
  let hasPrimary = existing.some((e) => e.primary);
  let position = existing.reduce((n, e) => Math.max(n, e.position + 1), 0);
  let added = 0;
  for (const img of input.images) {
    if (seen.has(img.sha256)) continue;
    seen.add(img.sha256);
    await db.insert(productImages).values({
      clientId: input.clientId,
      productId: input.productId,
      storageKey: img.storageKey,
      sha256: img.sha256,
      mime: img.mime,
      fileName: img.fileName.slice(0, 300),
      matchMethod: img.matchMethod,
      confidence: img.confidence,
      isPrimary: !hasPrimary,
      position: position++,
      sourceImportId: img.sourceImportId ?? null,
      createdBy: input.createdBy ?? null,
    });
    hasPrimary = true;
    added++;
  }
  return added;
}

export { completenessOf };
