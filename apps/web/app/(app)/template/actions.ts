"use server";

import { importTemplate, type TemplateStatus, transitionTemplate } from "@forgecy/carousel/catalog";
import { scanTemplateDir } from "@forgecy/carousel/node";
import { ForgecyError, assertCan } from "@forgecy/core";
import { getDb } from "@forgecy/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getStorage } from "../../render/_lib/templates";
import { enqueueTemplateValidation } from "./enqueue";

function fail(path: string, err: unknown): never {
  if (err instanceof ForgecyError || (err instanceof Error && err.name === "PermissionDeniedError"))
    redirect(`${path}?errore=${encodeURIComponent(err.message)}`);
  throw err;
}

/** «Importa» on a folder of templates/agency: becomes (or replaces) a draft. */
export async function importFolderAction(form: FormData) {
  const user = await requireUser();
  const folder = String(form.get("folder") ?? "");
  // Only folders the scan found: the name never becomes a path on its own.
  const entry = (await scanTemplateDir()).find((e) => e.folder === folder);
  if (!entry?.pkg) redirect(`/template?errore=${encodeURIComponent("Cartella non valida")}`);
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
    fail("/template", err);
  }
  await enqueueTemplateValidation(user, id);
  revalidatePath("/template");
  redirect(`/template/${id}`);
}

export async function transitionAction(form: FormData) {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const to = String(form.get("to") ?? "") as TemplateStatus;
  const notes = String(form.get("notes") ?? "");
  try {
    await transitionTemplate({ db: getDb(), actor: user.actor, id, to, notes });
  } catch (err) {
    fail(`/template/${id}`, err);
  }
  revalidatePath("/template");
  redirect(`/template/${id}`);
}

export async function revalidateAction(form: FormData) {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  try {
    assertCan(user.actor, "templates.manage");
  } catch (err) {
    fail(`/template/${id}`, err);
  }
  await enqueueTemplateValidation(user, id);
  redirect(`/template/${id}`);
}
