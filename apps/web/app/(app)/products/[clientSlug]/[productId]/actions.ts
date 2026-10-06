"use server";

import {
  acceptSensitiveField,
  decideFieldProposal,
  deleteProduct,
  duplicateProduct,
  fieldKeys,
  productFieldsSchema,
  updateProductFields,
  updateProductImage,
  type FieldKey,
} from "@forgecy/catalog";
import { getDb } from "@forgecy/db";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { paths } from "../../_lib/paths";
import { actingUser, attempt } from "../../_lib/server";
import type { ActionResult } from "../../_lib/types";

const fieldKey = z.enum(fieldKeys as [FieldKey, ...FieldKey[]]);

/** Saves one field; a stale revision is refused (CONFLICT-DRAFT-REV), never overwritten. */
export async function saveFieldAction(input: {
  clientId: string;
  productId: string;
  revision: number;
  field: FieldKey;
  value: unknown;
}): Promise<ActionResult> {
  const user = await requireUser();
  const field = fieldKey.parse(input.field);
  const parsed = productFieldsSchema.shape[field].safeParse(input.value);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid value" };
  return attempt(async () => {
    await updateProductFields(getDb(), actingUser(user), {
      clientId: z.uuid().parse(input.clientId),
      productId: z.uuid().parse(input.productId),
      revision: z.number().int().parse(input.revision),
      patch: { [field]: parsed.data },
    });
    return "Saved";
  });
}

export async function acceptSensitiveAction(input: {
  clientId: string;
  productId: string;
  field: FieldKey;
  note?: string;
}): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    await acceptSensitiveField(getDb(), actingUser(user), {
      clientId: z.uuid().parse(input.clientId),
      productId: z.uuid().parse(input.productId),
      field: fieldKey.parse(input.field),
      note: input.note?.slice(0, 1000),
    });
    return "Sensitive field accepted.";
  });
}

export async function decideProposalAction(input: {
  clientId: string;
  proposalId: string;
  decision: "accept" | "reject";
  editedValue?: unknown;
}): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    await decideFieldProposal(getDb(), actingUser(user), {
      clientId: z.uuid().parse(input.clientId),
      proposalId: z.uuid().parse(input.proposalId),
      decision: z.enum(["accept", "reject"]).parse(input.decision),
      editedValue: input.editedValue,
    });
    return input.decision === "accept" ? "Proposal accepted." : "Proposal rejected.";
  });
}

export async function imageAction(input: {
  clientId: string;
  imageId: string;
  action: "primary" | "unlink" | "approve" | "alt";
  alt?: string;
}): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    await updateProductImage(getDb(), actingUser(user), {
      clientId: z.uuid().parse(input.clientId),
      imageId: z.uuid().parse(input.imageId),
      action: z.enum(["primary", "unlink", "approve", "alt"]).parse(input.action),
      alt: input.alt?.slice(0, 300),
    });
  });
}

export async function duplicateAction(input: {
  clientId: string;
  clientSlug: string;
  productId: string;
}): Promise<ActionResult> {
  const user = await requireUser();
  let id = "";
  const r = await attempt(async () => {
    const row = await duplicateProduct(getDb(), actingUser(user), {
      clientId: z.uuid().parse(input.clientId),
      productId: z.uuid().parse(input.productId),
    });
    id = row.id;
  });
  if (r.error) return r;
  redirect(paths.product(input.clientSlug, id));
}

export async function deleteAction(input: {
  clientId: string;
  clientSlug: string;
  productId: string;
  typedName: string;
}): Promise<ActionResult> {
  const user = await requireUser();
  const r = await attempt(async () => {
    await deleteProduct(getDb(), actingUser(user), {
      clientId: z.uuid().parse(input.clientId),
      productId: z.uuid().parse(input.productId),
      typedName: String(input.typedName),
    });
  });
  if (r.error) return r;
  redirect(paths.catalog(input.clientSlug));
}
