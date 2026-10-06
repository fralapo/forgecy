"use server";

import { createProduct, loadCatalogClient, transitionProducts } from "@forgecy/catalog";
import { getDb } from "@forgecy/db";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { actingUser, attempt } from "../_lib/server";
import type { ActionResult } from "../_lib/types";
import { paths } from "../_lib/paths";

const bulkSchema = z.object({
  clientId: z.uuid(),
  ids: z.array(z.uuid()).min(1).max(1000),
  action: z.enum(["approve", "reject", "archive", "to_draft", "restore"]),
  note: z.string().trim().max(1000).optional(),
  revisions: z.record(z.string(), z.number().int()).optional(),
});

const verbs = {
  approve: ["Approvato", "Approvati"],
  reject: ["Rifiutato", "Rifiutati"],
  archive: ["Archiviato", "Archiviati"],
  to_draft: ["Riportato in bozza", "Riportati in bozza"],
  restore: ["Ripristinato", "Ripristinati"],
} as const;

/** Approve, reject, archive... one product or a selection; says what was left out and why. */
export async function transitionAction(input: z.input<typeof bulkSchema>): Promise<ActionResult> {
  const user = await requireUser();
  const data = bulkSchema.parse(input);
  return attempt(async () => {
    const r = await transitionProducts(getDb(), actingUser(user), data);
    const [one, many] = verbs[data.action];
    const total = r.done.length + r.skipped.length;
    if (r.skipped.length === 0)
      return r.done.length === 1 ? `${one} 1 prodotto.` : `${many} ${r.done.length} prodotti.`;
    const reasons = [...new Set(r.skipped.map((s) => s.reason))].join("; ");
    return `${many} ${r.done.length} prodotti su ${total}. ${r.skipped.length} esclusi: ${reasons}.`;
  });
}

const createSchema = z.object({
  clientSlug: z.string().min(1),
  clientId: z.uuid(),
  name: z.string().trim().min(1, "Scrivi il nome").max(200),
  sku: z.string().trim().max(80).optional(),
  category: z.string().trim().max(120).optional(),
});

/** «Aggiungi prodotto» → «Crea bozza», then opens the new product. */
export async function createProductAction(
  _prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = createSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dati non validi" };
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
