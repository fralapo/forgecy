"use server";

import {
  acceptItemSensitive,
  approveItems,
  closeReview,
  decideImage,
  decideItem,
  discardPending,
  editItemField,
  fieldKeys,
  productFieldsSchema,
  type FieldKey,
  type ItemAction,
} from "@forgecy/catalog";
import { getDb } from "@forgecy/db";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { firstIssue, refText } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { actingUser, attempt, skippedText } from "../../../../_lib/server";
import type { ActionResult } from "../../../../_lib/types";

const ids = z.object({ clientId: z.uuid(), importId: z.uuid() });
const fieldKey = z.enum(fieldKeys as [FieldKey, ...FieldKey[]]);

const itemActionSchema: z.ZodType<ItemAction> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("accept") }),
  z.object({ type: z.literal("approve"), note: z.string().max(1000).optional() }),
  z.object({ type: z.literal("discard"), reason: z.string().max(500).optional() }),
  z.object({ type: z.literal("recover") }),
  z.object({ type: z.literal("merge") }),
  z.object({ type: z.literal("keep_both") }),
  z.object({ type: z.literal("replace_fields"), fields: z.array(fieldKey).min(1) }),
  z.object({
    type: z.literal("conflict"),
    field: fieldKey,
    decision: z.enum(["keep", "accept", "defer"]),
    note: z.string().max(1000).optional(),
  }),
]);

export async function itemAction(input: {
  clientId: string;
  importId: string;
  itemId: string;
  action: ItemAction;
}): Promise<ActionResult> {
  const user = await requireUser();
  const data = ids.extend({ itemId: z.uuid(), action: itemActionSchema }).parse(input);
  return attempt(async () => {
    const t = await getTranslations("products");
    const r = await decideItem(getDb(), actingUser(user), data);
    if (r.message) return refText(r.messageRef, r.message);
    return t(`review.done.${data.action.type}`);
  });
}

export async function editItemAction(input: {
  clientId: string;
  importId: string;
  itemId: string;
  field: FieldKey;
  value: unknown;
}): Promise<ActionResult> {
  const user = await requireUser();
  const data = ids.extend({ itemId: z.uuid(), field: fieldKey }).parse(input);
  const parsed = productFieldsSchema.shape[data.field].safeParse(input.value);
  if (!parsed.success) return { error: await firstIssue(parsed.error) };
  return attempt(async () => {
    await editItemField(getDb(), actingUser(user), { ...data, value: parsed.data });
    return (await getTranslations("products"))("review.saved");
  });
}

export async function acceptItemSensitiveAction(input: {
  clientId: string;
  importId: string;
  itemId: string;
  field: FieldKey;
  note?: string;
}): Promise<ActionResult> {
  const user = await requireUser();
  const data = ids
    .extend({ itemId: z.uuid(), field: fieldKey, note: z.string().max(1000).optional() })
    .parse(input);
  return attempt(async () => {
    await acceptItemSensitive(getDb(), actingUser(user), data);
    return (await getTranslations("products"))("review.sensitiveAccepted");
  });
}

export async function approveItemsAction(input: {
  clientId: string;
  importId: string;
  itemIds: string[];
  note?: string;
}): Promise<ActionResult> {
  const user = await requireUser();
  const data = ids
    .extend({ itemIds: z.array(z.uuid()).min(1).max(5000), note: z.string().max(1000).optional() })
    .parse(input);
  return attempt(async () => {
    const t = await getTranslations("products");
    const r = await approveItems(getDb(), actingUser(user), data);
    if (!r.excluded.length) return t("review.approvedCount", { count: r.approved });
    const reasons = [...new Set(await Promise.all(r.excluded.map(skippedText)))].join("; ");
    return t("review.approvedPartial", {
      count: r.approved,
      skipped: r.excluded.length,
      reasons,
    });
  });
}

export async function imageDecisionAction(input: {
  clientId: string;
  importId: string;
  fileId: string;
  action: "assign" | "accept_suggestion" | "ignore";
  itemId?: string;
}): Promise<ActionResult> {
  const user = await requireUser();
  const data = ids
    .extend({
      fileId: z.uuid(),
      action: z.enum(["assign", "accept_suggestion", "ignore"]),
      itemId: z.uuid().optional(),
    })
    .parse(input);
  return attempt(() => decideImage(getDb(), actingUser(user), data));
}

export async function discardPendingAction(input: {
  clientId: string;
  importId: string;
}): Promise<ActionResult> {
  const user = await requireUser();
  const data = ids.parse(input);
  return attempt(async () => {
    const n = await discardPending(getDb(), actingUser(user), data);
    return (await getTranslations("products"))("review.rejectedCount", { count: n });
  });
}

export async function closeReviewAction(input: {
  clientId: string;
  importId: string;
}): Promise<ActionResult> {
  const user = await requireUser();
  const data = ids.parse(input);
  return attempt(async () => {
    const r = await closeReview(getDb(), actingUser(user), data);
    return (await getTranslations("products"))("review.closed", {
      approved: r.approved,
      proposed: r.proposed,
      discarded: r.discarded,
      images: r.unassignedImages,
    });
  });
}
