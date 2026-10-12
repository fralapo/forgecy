"use server";

import { createProduct, loadCatalogClient, transitionProducts } from "@forgecy/catalog";
import { getDb } from "@forgecy/db";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { firstIssue, vmsg } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { actingUser, attempt, skippedText } from "../_lib/server";
import type { ActionResult } from "../_lib/types";
import { paths } from "../_lib/paths";

const bulkSchema = z.object({
  clientId: z.uuid(),
  ids: z.array(z.uuid()).min(1).max(1000),
  action: z.enum(["approve", "reject", "archive", "to_draft", "restore"]),
  note: z.string().trim().max(1000).optional(),
  revisions: z.record(z.string(), z.number().int()).optional(),
});

/** Approve, reject, archive... one product or a selection; says what was left out and why. */
export async function transitionAction(input: z.input<typeof bulkSchema>): Promise<ActionResult> {
  const user = await requireUser();
  const data = bulkSchema.parse(input);
  return attempt(async () => {
    const t = await getTranslations("products");
    const r = await transitionProducts(getDb(), actingUser(user), data);
    const total = r.done.length + r.skipped.length;
    if (r.skipped.length === 0)
      return t("transition.done", { action: data.action, count: r.done.length });
    const reasons = [...new Set(await Promise.all(r.skipped.map(skippedText)))].join("; ");
    return t("transition.partial", {
      action: data.action,
      done: r.done.length,
      total,
      skipped: r.skipped.length,
      reasons,
    });
  });
}

const createSchema = z.object({
  clientSlug: z.string().min(1),
  clientId: z.uuid(),
  name: z.string().trim().min(1, vmsg("products.validation.nameRequired")).max(200),
  sku: z.string().trim().max(80).optional(),
  category: z.string().trim().max(120).optional(),
});

/** “Add product” → “Create draft”, then opens the new product. */
export async function createProductAction(
  _prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = createSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: await firstIssue(parsed.error) };
  const { clientSlug, ...input } = parsed.data;
  let id = "";
  const r = await attempt(async () => {
    await loadCatalogClient(getDb(), input.clientId);
    const row = await createProduct(getDb(), actingUser(user), {
      ...input,
      sku: input.sku || undefined,
      category: input.category || undefined,
    });
    id = row.id;
  });
  if (r.error) return r;
  redirect(paths.product(clientSlug, id));
}
