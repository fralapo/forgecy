"use server";

import {
  importTemplate,
  listTemplates,
  type TemplateStatus,
  transitionTemplate,
} from "@forgecy/carousel/catalog";
import { scanTemplateDir } from "@forgecy/carousel/node";
import { ForgecyError, assertCan } from "@forgecy/core";
import { getDb } from "@forgecy/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { errorMessage } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { getStorage } from "../../render/_lib/templates";
import { enqueueTemplateValidation } from "./enqueue";

/** Back to the page with the error in the user's language. */
async function fail(path: string, err: unknown): Promise<never> {
  if (err instanceof ForgecyError || (err instanceof Error && err.name === "PermissionDeniedError"))
    redirect(`${path}?error=${encodeURIComponent((await errorMessage(err)) ?? err.message)}`);
  throw err;
}

/** “Import” on a folder of templates: becomes (or replaces) a draft. */
export async function importFolderAction(form: FormData) {
  const user = await requireUser();
  const folder = String(form.get("folder") ?? "");
  // Only folders the scan found: the name never becomes a path on its own.
  const entry = (await scanTemplateDir()).find((e) => e.folder === folder);
  if (!entry?.pkg) {
    const t = await getTranslations("templates.errors");
    redirect(`/templates?error=${encodeURIComponent(t("invalidFolder"))}`);
  }
  let id: string;
  try {
    const { row } = await importTemplate({
      db: getDb(),
      storage: getStorage(),
      actor: user.actor,
      files: entry.pkg.files,
    });
    id = row.id;
  } catch (err) {
    return fail("/templates", err);
  }
  await enqueueTemplateValidation(user, id);
  revalidatePath("/templates");
  redirect(`/templates/${id}`);
}

/** One click: every valid starter template is imported, checked by the worker and published. */
export async function installStartersAction() {
  const user = await requireUser();
  const t = await getTranslations("templates");
  const known = new Set((await listTemplates(getDb())).map((r) => `${r.key}@${r.version}`));
  try {
    for (const { pkg } of await scanTemplateDir()) {
      if (!pkg || known.has(`${pkg.manifest.id}@${pkg.manifest.version}`)) continue;
      const { row } = await importTemplate({
        db: getDb(),
        storage: getStorage(),
        actor: user.actor,
        files: pkg.files,
      });
      await enqueueTemplateValidation(user, row.id, t("import.starterNotes"));
    }
  } catch (err) {
    return fail("/templates", err);
  }
  revalidatePath("/templates");
  redirect("/templates?installing=1");
}

export async function transitionAction(form: FormData) {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const to = String(form.get("to") ?? "") as TemplateStatus;
  const notes = String(form.get("notes") ?? "");
  try {
    await transitionTemplate({ db: getDb(), actor: user.actor, id, to, notes });
  } catch (err) {
    await fail(`/templates/${id}`, err);
  }
  revalidatePath("/templates");
  redirect(`/templates/${id}`);
}

export async function revalidateAction(form: FormData) {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  try {
    assertCan(user.actor, "templates.manage");
  } catch (err) {
    await fail(`/templates/${id}`, err);
  }
  await enqueueTemplateValidation(user, id);
  redirect(`/templates/${id}`);
}
