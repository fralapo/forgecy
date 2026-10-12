import { assertCan, ForgecyError, type ConfidenceLevel, type MessageRef } from "@forgecy/core";
import { englishMessage, localizedError, messageRef, type MessageValues } from "@forgecy/i18n";
import {
  and,
  eq,
  inArray,
  productImportFiles,
  productImportItems,
  productImports,
  products,
  recordAuditEvent,
  sql,
  type Database,
} from "@forgecy/db";
import { isNotNull } from "drizzle-orm";
import type { ImageRef } from "./candidates";
import type { ActingUser, Tx } from "../db";
import {
  emptyFields,
  fieldKeys,
  isEmptyValue,
  productFieldsSchema,
  sameValue,
  type FieldKey,
  type ProductDraft,
  type ProductFields,
} from "../products/fields";
import { loadImport, type ImportItemRow } from "./imports";
import type { FieldMeta, FieldMetaMap } from "../products/meta";
import {
  approvalBlockerList,
  attachImages,
  blockerError,
  blockerText,
  invalidFieldError,
  type ApprovalBlocker,
  fieldsToColumns,
  loadProduct,
  pendingSensitive,
  proposeField,
  rowToFields,
  withSensitivity,
} from "../products/products";

export type ReviewTab = "new" | "duplicates" | "conflicts" | "images" | "discarded";

/** Which tab an item belongs to. */
export function itemTab(
  item: Pick<ImportItemRow, "status" | "matchProductId" | "conflicts">,
): Exclude<ReviewTab, "images"> {
  if (item.status === "discarded") return "discarded";
  if (item.matchProductId && (item.conflicts as unknown[]).length) return "conflicts";
  if (item.matchProductId) return "duplicates";
  return "new";
}

export const itemDecided = (i: Pick<ImportItemRow, "status">) => i.status !== "pending";

async function lockItem(
  tx: Tx,
  clientId: string,
  importId: string,
  itemId: string,
): Promise<ImportItemRow> {
  const [item] = await tx
    .select()
    .from(productImportItems)
    .where(
      and(
        eq(productImportItems.id, itemId),
        eq(productImportItems.importId, importId),
        eq(productImportItems.clientId, clientId),
      ),
    )
    .for("update");
  if (!item) throw localizedError("not_found", "products.errors.itemNotFound");
  return item;
}

async function assertReviewOpen(tx: Tx, clientId: string, importId: string) {
  const imp = await loadImport(tx, clientId, importId);
  if (imp.status !== "ready_for_review")
    throw localizedError("conflict", "products.errors.reviewNotOpen", undefined, {
      code: "CONFLICT-STATE",
    });
  return imp;
}

const draftOf = (i: ImportItemRow) => i.draft as ProductDraft;
const metaOfItem = (i: ImportItemRow) => i.fieldMeta as FieldMetaMap;
const imagesOf = (i: ImportItemRow) => i.images as unknown as ImageRef[];

/** Copy the item's images (import files) to the product. */
async function attachItemImages(
  tx: Tx,
  clientId: string,
  productId: string,
  importId: string,
  refs: ImageRef[],
  userId: string,
) {
  if (!refs.length) return;
  const rows = await tx
    .select()
    .from(productImportFiles)
    .where(
      and(
        eq(productImportFiles.importId, importId),
        inArray(
          productImportFiles.id,
          refs.map((r) => r.fileId),
        ),
      ),
    );
  await attachImages(tx, {
    clientId,
    productId,
    createdBy: userId,
    images: rows
      .filter((r) => r.storageKey && r.sha256 && r.mime)
      .map((r) => {
        const ref = refs.find((x) => x.fileId === r.id)!;
        return {
          storageKey: r.storageKey!,
          sha256: r.sha256!,
          mime: r.mime!,
          fileName: r.name,
          matchMethod: ref.method,
          confidence: ref.confidence,
          sourceImportId: importId,
        };
      }),
  });
  await tx
    .update(productImportFiles)
    .set({ imageState: "assigned" })
    .where(
      inArray(
        productImportFiles.id,
        rows.map((r) => r.id),
      ),
    );
}

/** Create a catalog product from a reviewed item: proposed, or approved by this person. */
async function createFromItem(
  tx: Tx,
  user: ActingUser,
  item: ImportItemRow,
  status: "proposed" | "approved",
  note?: string,
): Promise<string> {
  const fields = { ...emptyFields(), ...draftOf(item) } as ProductFields;
  const meta: FieldMetaMap = {};
  for (const [k, m] of Object.entries(metaOfItem(item)) as Array<[FieldKey, FieldMeta]>)
    meta[k] = { ...m, truth: status === "approved" ? "approved" : "proposed" };
  const [row] = await tx
    .insert(products)
    .values({
      clientId: item.clientId,
      status,
      ...fieldsToColumns(fields),
      fieldMeta: meta as Record<string, unknown>,
      origin: item.origin,
      sourceImportId: item.importId,
      proposedByAgent: item.proposedByAgent,
      createdBy: user.id,
      updatedBy: user.id,
      ...(status === "approved"
        ? { approvedBy: user.id, approvedAt: new Date(), approvalNote: note?.trim() || null }
        : {}),
    })
    .returning({ id: products.id });
  await attachItemImages(tx, item.clientId, row!.id, item.importId, imagesOf(item), user.id);
  await recordAuditEvent(tx, {
    actor: user.actor,
    action: status === "approved" ? "product_approved" : "product.create_from_import",
    entity: "product",
    entityId: row!.id,
    clientId: item.clientId,
    meta: { importId: item.importId, itemId: item.id, agent: item.proposedByAgent },
  });
  return row!.id;
}

/** If the matched product changed after the analysis, refresh the comparison and stop. */
async function assertMatchFresh(tx: Tx, item: ImportItemRow) {
  if (!item.matchProductId) return null;
  const product = await loadProduct(tx, item.clientId, item.matchProductId);
  if (item.matchRevision !== null && product.revision !== item.matchRevision) {
    const current = rowToFields(product);
    const conflicts =
      product.status === "approved"
        ? fieldKeys
            .filter(
              (k) =>
                !isEmptyValue(draftOf(item)[k]) &&
                !isEmptyValue(current[k]) &&
                !sameValue(current[k], draftOf(item)[k]),
            )
            .map((k) => ({ field: k, approved: current[k], incoming: draftOf(item)[k] }))
        : [];
    await tx
      .update(productImportItems)
      .set({
        matchRevision: product.revision,
        conflicts: conflicts as unknown as Record<string, unknown>[],
        conflictDecisions: {},
      })
      .where(eq(productImportItems.id, item.id));
    return { stale: true as const, product };
  }
  return { stale: false as const, product };
}

export type ItemAction =
  | { type: "accept" }
  | { type: "approve"; note?: string }
  | { type: "discard"; reason?: string }
  | { type: "recover" }
  | { type: "merge" }
  | { type: "keep_both" }
  | { type: "replace_fields"; fields: FieldKey[] }
  | { type: "conflict"; field: FieldKey; decision: "keep" | "accept" | "defer"; note?: string };

/**
 * One review decision. Nothing approved is ever overwritten silently: merges and
 * replacements on an approved product become field proposals, conflicts need an
 * explicit choice per field.
 */
export async function decideItem(
  db: Database,
  user: ActingUser,
  input: { clientId: string; importId: string; itemId: string; action: ItemAction },
): Promise<{ productId?: string; message?: string; messageRef?: MessageRef }> {
  const a = input.action;
  const permission =
    a.type === "approve" || (a.type === "conflict" && a.decision === "accept")
      ? "approve"
      : a.type === "discard"
        ? "review"
        : "products.manage";
  assertCan(user.actor, permission, input.clientId);
  return db.transaction(async (tx) => {
    await assertReviewOpen(tx, input.clientId, input.importId);
    const item = await lockItem(tx, input.clientId, input.importId, input.itemId);
    const decided = { decidedBy: user.id, decidedAt: new Date() };
    const audit = (action: string, meta: Record<string, unknown> = {}) =>
      recordAuditEvent(tx, {
        actor: user.actor,
        action,
        entity: "product_import",
        entityId: input.importId,
        clientId: input.clientId,
        meta: { itemId: item.id, ...meta },
      });

    switch (a.type) {
      case "accept": {
        if (item.status !== "pending") throw stateConflict();
        const productId = await createFromItem(tx, user, item, "proposed");
        await tx
          .update(productImportItems)
          .set({
            status: "accepted",
            productId,
            resolution: item.matchProductId ? "keep_both" : null,
            ...decided,
          })
          .where(eq(productImportItems.id, item.id));
        await audit("product_import.item_accepted", { productId });
        return { productId };
      }
      case "approve": {
        if (item.status !== "pending" && item.status !== "accepted") throw stateConflict();
        if (item.matchProductId && item.status === "pending")
          throw localizedError("validation", "products.errors.decideDuplicateFirst");
        const blockers = approvalBlockerList(draftOf(item), metaOfItem(item));
        if (blockers.length) throw blockerError(blockers[0]!);
        let productId = item.productId;
        if (productId) {
          const p = await loadProduct(tx, input.clientId, productId);
          if (p.status !== "proposed" && p.status !== "draft") throw stateConflict();
          const meta = Object.fromEntries(
            Object.entries(p.fieldMeta).map(([k, m]) => [
              k,
              { ...(m as FieldMeta), truth: "approved" },
            ]),
          );
          await tx
            .update(products)
            .set({
              status: "approved",
              fieldMeta: meta,
              approvedBy: user.id,
              approvedAt: new Date(),
              approvalNote: a.note?.trim() || null,
              revision: sql`${products.revision} + 1`,
            })
            .where(eq(products.id, productId));
          await recordAuditEvent(tx, {
            actor: user.actor,
            action: "product_approved",
            entity: "product",
            entityId: productId,
            clientId: input.clientId,
            meta: { importId: input.importId },
          });
        } else productId = await createFromItem(tx, user, item, "approved", a.note);
        await tx
          .update(productImportItems)
          .set({ status: "approved", productId, ...decided })
          .where(eq(productImportItems.id, item.id));
        return { productId };
      }
      case "discard": {
        if (item.status !== "pending") throw stateConflict();
        await tx
          .update(productImportItems)
          .set({
            status: "discarded",
            ...discardOf(a.reason),
            ...decided,
          })
          .where(eq(productImportItems.id, item.id));
        await audit("product_import.item_discarded");
        return {};
      }
      case "recover": {
        if (item.status !== "discarded") throw stateConflict();
        await tx
          .update(productImportItems)
          .set({
            status: "pending",
            discardReason: null,
            discardRef: null,
            decidedBy: null,
            decidedAt: null,
          })
          .where(eq(productImportItems.id, item.id));
        return {};
      }
      case "keep_both": {
        if (item.status !== "pending" || !item.matchProductId) throw stateConflict();
        const productId = await createFromItem(tx, user, item, "proposed");
        await tx
          .update(productImportItems)
          .set({ status: "accepted", productId, resolution: "keep_both", ...decided })
          .where(eq(productImportItems.id, item.id));
        await audit("product_duplicate_resolved", { action: "keep_both" });
        return { productId };
      }
      case "merge":
      case "replace_fields": {
        if (item.status !== "pending" || !item.matchProductId) throw stateConflict();
        const fresh = await assertMatchFresh(tx, item);
        if (fresh?.stale) return stale(fresh.product.name);
        const product = fresh!.product;
        const current = rowToFields(product);
        const incoming = draftOf(item);
        const meta = metaOfItem(item);
        const chosen =
          a.type === "merge"
            ? // Merge: new fields only (empty on the product) or, on a non-approved product, every new value.
              fieldKeys.filter(
                (k) => !isEmptyValue(incoming[k]) && !sameValue(current[k], incoming[k]),
              )
            : a.fields.filter((k) => fieldKeys.includes(k) && !isEmptyValue(incoming[k]));
        const direct: FieldKey[] = [];
        let proposals = 0;
        for (const k of chosen) {
          if (
            product.status !== "approved" &&
            (a.type === "replace_fields" || isEmptyValue(current[k]))
          )
            direct.push(k);
          else {
            await proposeField(tx, {
              clientId: input.clientId,
              productId: product.id,
              field: k,
              currentValue: current[k],
              proposedValue: incoming[k],
              meta: meta[k] ?? {
                truth: "proposed",
                source: item.origin as never,
                confidence: item.confidence,
              },
              importId: input.importId,
              proposedBy: item.proposedByAgent ? "agent:brand_analyst" : `user:${user.id}`,
            });
            proposals++;
          }
        }
        if (direct.length)
          await applyFields(
            tx,
            user,
            product.id,
            input.clientId,
            direct.map((k) => ({ field: k, value: incoming[k], meta: meta[k] })),
          );
        await attachItemImages(
          tx,
          input.clientId,
          product.id,
          input.importId,
          imagesOf(item),
          user.id,
        );
        await tx
          .update(productImportItems)
          .set({ status: "merged", productId: product.id, resolution: a.type, ...decided })
          .where(eq(productImportItems.id, item.id));
        await audit("product_duplicate_resolved", { action: a.type, fields: chosen, proposals });
        return {
          productId: product.id,
          ...(proposals
            ? {
                message: englishMessage("products.review.mergeProposals", { count: proposals }),
                messageRef: messageRef("products.review.mergeProposals", { count: proposals }),
              }
            : {}),
        };
      }
      case "conflict": {
        if (item.status !== "pending" || !item.matchProductId) throw stateConflict();
        const conflicts = item.conflicts as unknown as Array<{
          field: FieldKey;
          approved: unknown;
          incoming: unknown;
        }>;
        const conflict = conflicts.find((c) => c.field === a.field);
        if (!conflict) throw localizedError("validation", "products.errors.conflictNotFound");
        const fresh = await assertMatchFresh(tx, item);
        if (fresh?.stale) return stale(fresh.product.name);
        const meta = metaOfItem(item)[a.field];
        if (a.decision === "accept") {
          if (meta?.sensitive?.length && meta.confidence === "low" && !a.note?.trim())
            throw localizedError("validation", "products.errors.sensitiveLowConfidence");
          await applyFields(
            tx,
            user,
            item.matchProductId,
            input.clientId,
            [
              {
                field: a.field,
                value: conflict.incoming,
                meta: meta
                  ? {
                      ...meta,
                      ...(meta.sensitive?.length
                        ? {
                            acceptedBy: user.id,
                            acceptedAt: new Date().toISOString(),
                            ...(a.note?.trim() ? { acceptNote: a.note.trim() } : {}),
                          }
                        : {}),
                    }
                  : undefined,
              },
            ],
            { keepAccepted: true },
          );
        } else if (a.decision === "defer") {
          await proposeField(tx, {
            clientId: input.clientId,
            productId: item.matchProductId,
            field: a.field,
            currentValue: conflict.approved,
            proposedValue: conflict.incoming,
            meta: meta ?? {
              truth: "proposed",
              source: item.origin as never,
              confidence: item.confidence,
            },
            importId: input.importId,
            proposedBy: item.proposedByAgent ? "agent:brand_analyst" : `user:${user.id}`,
          });
        }
        const decisions = {
          ...(item.conflictDecisions as Record<string, string>),
          [a.field]: a.decision,
        };
        const all = conflicts.every((c) => decisions[c.field]);
        await tx
          .update(productImportItems)
          .set({
            conflictDecisions: decisions,
            ...(all
              ? {
                  status: "merged" as const,
                  productId: item.matchProductId,
                  resolution: "conflicts",
                  ...decided,
                }
              : {}),
          })
          .where(eq(productImportItems.id, item.id));
        if (all) {
          const product = await loadProduct(tx, input.clientId, item.matchProductId);
          await attachItemImages(
            tx,
            input.clientId,
            product.id,
            input.importId,
            imagesOf(item),
            user.id,
          );
        }
        await audit("product_import.conflict_decided", { field: a.field, decision: a.decision });
        return { productId: item.matchProductId };
      }
    }
  });
}

function stale(name: string) {
  const values: MessageValues = { name };
  return {
    message: englishMessage("products.review.stale", values),
    messageRef: messageRef("products.review.stale", values),
  };
}

function stateConflict() {
  return localizedError("conflict", "products.errors.itemDecided", undefined, {
    code: "CONFLICT-STATE",
  });
}

/** Write values on a product after an explicit decision, with history. */
async function applyFields(
  tx: Tx,
  user: ActingUser,
  productId: string,
  clientId: string,
  changes: Array<{ field: FieldKey; value: unknown; meta?: FieldMeta | undefined }>,
  opts: { keepAccepted?: boolean } = {},
) {
  const product = await loadProduct(tx, clientId, productId);
  const before = rowToFields(product);
  const after = { ...before } as ProductFields;
  let meta = { ...(product.fieldMeta as FieldMetaMap) };
  const changed: FieldKey[] = [];
  for (const c of changes) {
    const parsed = productFieldsSchema.shape[c.field].safeParse(c.value);
    if (!parsed.success) continue;
    (after as Record<string, unknown>)[c.field] = parsed.data;
    meta[c.field] = {
      ...(c.meta ?? {
        source: { kind: "manual", userId: user.id, userName: user.name },
        confidence: "high" as ConfidenceLevel,
      }),
      truth: product.status === "approved" ? "approved" : "proposed",
      updatedAt: new Date().toISOString(),
    } as FieldMeta;
    changed.push(c.field);
  }
  if (!changed.length) return;
  if (!opts.keepAccepted) meta = withSensitivity(after, meta, changed);
  await tx
    .update(products)
    .set({
      ...fieldsToColumns(after),
      fieldMeta: meta as Record<string, unknown>,
      updatedBy: user.id,
      revision: sql`${products.revision} + 1`,
    })
    .where(eq(products.id, productId));
  await recordAuditEvent(tx, {
    actor: user.actor,
    action: "product.update",
    entity: "product",
    entityId: productId,
    clientId,
    meta: {
      fields: changed,
      before: Object.fromEntries(changed.map((k) => [k, before[k]])),
      after: Object.fromEntries(changed.map((k) => [k, after[k]])),
      wasApproved: product.status === "approved",
      via: "import_review",
    },
  });
}

/** Inline edit of an extracted value: it becomes "Entered manually by …". */
export async function editItemField(
  db: Database,
  user: ActingUser,
  input: { clientId: string; importId: string; itemId: string; field: FieldKey; value: unknown },
): Promise<void> {
  assertCan(user.actor, "products.manage", input.clientId);
  await db.transaction(async (tx) => {
    await assertReviewOpen(tx, input.clientId, input.importId);
    const item = await lockItem(tx, input.clientId, input.importId, input.itemId);
    if (item.status !== "pending") throw stateConflict();
    const parsed = productFieldsSchema.shape[input.field].safeParse(input.value);
    if (!parsed.success) throw invalidFieldError(input.field);
    const draft = { ...draftOf(item) } as Record<string, unknown>;
    let meta = { ...metaOfItem(item) };
    if (isEmptyValue(parsed.data)) {
      delete draft[input.field];
      delete meta[input.field];
    } else {
      draft[input.field] = parsed.data;
      meta[input.field] = {
        truth: "proposed",
        source: { kind: "manual", userId: user.id, userName: user.name },
        confidence: "high",
      };
      meta = withSensitivity(draft as ProductDraft, meta, [input.field], user.id);
    }
    await tx
      .update(productImportItems)
      .set({
        draft,
        fieldMeta: meta as Record<string, unknown>,
        sensitive: Object.values(meta).some((m) => m?.sensitive?.length && !m.acceptedBy),
      })
      .where(eq(productImportItems.id, item.id));
  });
}

/** Accept one sensitive field of an item (note mandatory at Low confidence). */
export async function acceptItemSensitive(
  db: Database,
  user: ActingUser,
  input: { clientId: string; importId: string; itemId: string; field: FieldKey; note?: string },
): Promise<void> {
  assertCan(user.actor, "approve", input.clientId);
  await db.transaction(async (tx) => {
    await assertReviewOpen(tx, input.clientId, input.importId);
    const item = await lockItem(tx, input.clientId, input.importId, input.itemId);
    const meta = { ...metaOfItem(item) };
    const m = meta[input.field];
    if (!m?.sensitive?.length) throw localizedError("validation", "products.errors.notSensitive");
    const note = input.note?.trim();
    if (m.confidence === "low" && !note)
      throw localizedError("validation", "products.errors.lowConfidenceNote");
    meta[input.field] = {
      ...m,
      acceptedBy: user.id,
      acceptedAt: new Date().toISOString(),
      ...(note ? { acceptNote: note } : {}),
    };
    await tx
      .update(productImportItems)
      .set({
        fieldMeta: meta as Record<string, unknown>,
        sensitive: pendingSensitive(draftOf(item), meta).length > 0,
      })
      .where(eq(productImportItems.id, item.id));
    await recordAuditEvent(tx, {
      actor: user.actor,
      action: "product_import.sensitive_accept",
      entity: "product_import",
      entityId: input.importId,
      clientId: input.clientId,
      meta: { itemId: item.id, field: input.field, confidence: m.confidence },
    });
  });
}

/** An item left out of a bulk approval: English `reason`, and `ref` or `blocker` for the interface. */
export interface ExcludedItem {
  id: string;
  name: string;
  reason: string;
  ref?: MessageRef;
  blocker?: ApprovalBlocker;
}

/**
 * "Approve selected" in the New tab: excludes and reports the items with
 * sensitive fields not accepted or missing required fields.
 */
export async function approveItems(
  db: Database,
  user: ActingUser,
  input: { clientId: string; importId: string; itemIds: string[]; note?: string },
): Promise<{ approved: number; excluded: ExcludedItem[] }> {
  assertCan(user.actor, "approve", input.clientId);
  const excluded: ExcludedItem[] = [];
  let approved = 0;
  for (const id of [...new Set(input.itemIds)].slice(0, 2000)) {
    const [item] = await db
      .select()
      .from(productImportItems)
      .where(and(eq(productImportItems.id, id), eq(productImportItems.importId, input.importId)));
    if (
      !item ||
      (item.status !== "pending" && item.status !== "accepted") ||
      (item.matchProductId && item.status === "pending")
    )
      continue;
    const draft = draftOf(item);
    const meta = metaOfItem(item);
    if (pendingSensitive(draft, meta).length) {
      excluded.push({
        id,
        name: draft.name ?? "",
        reason: englishMessage("products.skipped.sensitive"),
        ref: messageRef("products.skipped.sensitive"),
      });
      continue;
    }
    const blockers = approvalBlockerList(draft, meta);
    if (blockers.length) {
      excluded.push({
        id,
        name: draft.name ?? "",
        reason: blockerText(blockers[0]!),
        blocker: blockers[0]!,
      });
      continue;
    }
    try {
      await decideItem(db, user, {
        clientId: input.clientId,
        importId: input.importId,
        itemId: id,
        action: { type: "approve", ...(input.note ? { note: input.note } : {}) },
      });
      approved++;
    } catch (err) {
      if (err instanceof ForgecyError && err.code !== "permission_denied")
        excluded.push({
          id,
          name: draft.name ?? "",
          reason: err.message,
          ...(err.ref ? { ref: err.ref } : {}),
          ...(err.details?.blocker ? { blocker: err.details.blocker as ApprovalBlocker } : {}),
        });
      else throw err;
    }
  }
  return { approved, excluded };
}

/** Assign an unassigned image to an item (or its product), accept the suggestion, or ignore it. */
export async function decideImage(
  db: Database,
  user: ActingUser,
  input: {
    clientId: string;
    importId: string;
    fileId: string;
    action: "assign" | "accept_suggestion" | "ignore";
    itemId?: string;
  },
): Promise<void> {
  assertCan(user.actor, "products.manage", input.clientId);
  await db.transaction(async (tx) => {
    await assertReviewOpen(tx, input.clientId, input.importId);
    const [file] = await tx
      .select()
      .from(productImportFiles)
      .where(
        and(
          eq(productImportFiles.id, input.fileId),
          eq(productImportFiles.importId, input.importId),
          eq(productImportFiles.kind, "image"),
        ),
      );
    if (!file) throw localizedError("not_found", "products.errors.imageNotFound");
    if (input.action === "ignore") {
      await tx
        .update(productImportFiles)
        .set({ imageState: "ignored" })
        .where(eq(productImportFiles.id, file.id));
      return;
    }
    const itemId =
      input.action === "assign"
        ? input.itemId
        : ((file.suggestion as { itemId?: string } | null)?.itemId ?? undefined);
    if (!itemId) throw localizedError("validation", "products.errors.chooseProductForImage");
    const item = await lockItem(tx, input.clientId, input.importId, itemId);
    const ref: ImageRef = {
      fileId: file.id,
      method: input.action === "assign" ? "manual" : "ai",
      confidence:
        input.action === "assign"
          ? "high"
          : ((file.suggestion as { confidence?: ConfidenceLevel } | null)?.confidence ?? "low"),
    };
    const target = item.productId ?? (item.status === "merged" ? item.matchProductId : null);
    if (target) await attachItemImages(tx, input.clientId, target, input.importId, [ref], user.id);
    else {
      const images = [...imagesOf(item).filter((i) => i.fileId !== file.id), ref];
      await tx
        .update(productImportItems)
        .set({ images: images as unknown as Record<string, unknown>[] })
        .where(eq(productImportItems.id, item.id));
      await tx
        .update(productImportFiles)
        .set({ imageState: "assigned" })
        .where(eq(productImportFiles.id, file.id));
    }
  });
}

/** Reason of a rejection in review: the person's words, or a message in the reader's language. */
function discardOf(reason: string | undefined) {
  const typed = reason?.trim().slice(0, 300);
  return typed
    ? { discardReason: typed, discardRef: null }
    : {
        discardReason: englishMessage("products.discards.inReview"),
        discardRef: messageRef("products.discards.inReview"),
      };
}

/** "Reject all undecided" (recoverable while the review is open). */
export async function discardPending(
  db: Database,
  user: ActingUser,
  input: { clientId: string; importId: string },
): Promise<number> {
  assertCan(user.actor, "review", input.clientId);
  return db.transaction(async (tx) => {
    await assertReviewOpen(tx, input.clientId, input.importId);
    const rows = await tx
      .update(productImportItems)
      .set({
        status: "discarded",
        discardReason: englishMessage("products.discards.inBulkReview"),
        discardRef: messageRef("products.discards.inBulkReview"),
        decidedBy: user.id,
        decidedAt: new Date(),
      })
      .where(
        and(
          eq(productImportItems.importId, input.importId),
          eq(productImportItems.status, "pending"),
        ),
      )
      .returning({ id: productImportItems.id });
    await recordAuditEvent(tx, {
      actor: user.actor,
      action: "product_import.discard_pending",
      entity: "product_import",
      entityId: input.importId,
      clientId: input.clientId,
      meta: { count: rows.length },
    });
    return rows.length;
  });
}

/**
 * "Close review": allowed when every duplicate and conflict is decided. Items not
 * decided enter the catalog as `proposed` with their provenance; the import ends
 * `completed`, or `partial` when discarded items or unassigned images remain.
 */
export async function closeReview(
  db: Database,
  user: ActingUser,
  input: { clientId: string; importId: string },
): Promise<{
  status: "completed" | "partial";
  proposed: number;
  approved: number;
  discarded: number;
  unassignedImages: number;
}> {
  assertCan(user.actor, "products.manage", input.clientId);
  return db.transaction(async (tx) => {
    await assertReviewOpen(tx, input.clientId, input.importId);
    const items = await tx
      .select()
      .from(productImportItems)
      .where(eq(productImportItems.importId, input.importId))
      .for("update");
    const undecidedMatches = items.filter((i) => i.status === "pending" && i.matchProductId);
    if (undecidedMatches.length)
      throw localizedError("validation", "products.errors.decideMatchesFirst", {
        count: undecidedMatches.length,
      });
    let proposed = 0;
    for (const item of items.filter((i) => i.status === "pending")) {
      const productId = await createFromItem(tx, user, item, "proposed");
      await tx
        .update(productImportItems)
        .set({ status: "accepted", productId, decidedBy: user.id, decidedAt: new Date() })
        .where(eq(productImportItems.id, item.id));
      proposed++;
    }
    const discarded = items.filter((i) => i.status === "discarded").length;
    const approved = items.filter((i) => i.status === "approved").length;
    const [{ n }] = (await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(productImportFiles)
      .where(
        and(
          eq(productImportFiles.importId, input.importId),
          eq(productImportFiles.imageState, "unassigned"),
          isNotNull(productImportFiles.storageKey),
        ),
      )) as [{ n: number }];
    const status = discarded > 0 || n > 0 ? "partial" : "completed";
    await tx
      .update(productImports)
      .set({ status, closedBy: user.id, closedAt: new Date() })
      .where(eq(productImports.id, input.importId));
    await recordAuditEvent(tx, {
      actor: user.actor,
      action: "product_import_completed",
      entity: "product_import",
      entityId: input.importId,
      clientId: input.clientId,
      meta: { approved, proposed, discarded, unassignedImages: n, status },
    });
    return { status, proposed, approved, discarded, unassignedImages: n };
  });
}
