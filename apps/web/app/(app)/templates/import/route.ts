import { importTemplate } from "@forgecy/carousel/catalog";
import { unzipTemplatePackage } from "@forgecy/carousel/node";
import { ForgecyError } from "@forgecy/core";
import { getDb } from "@forgecy/db";
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { errorMessage } from "@/lib/i18n";
import { getCurrentUser } from "@/lib/session";
import { getStorage } from "../../../render/_lib/templates";
import { enqueueTemplateValidation } from "../enqueue";

export const dynamic = "force-dynamic";

const MAX = 50 * 1024 * 1024;

/** “Import template”: a ZIP of the package (max 50 MB) becomes a draft, then the worker validates it. */
export async function POST(request: Request) {
  const back = (path: string, error?: string) =>
    NextResponse.redirect(
      new URL(error ? `${path}?error=${encodeURIComponent(error)}` : path, request.url),
      303,
    );
  const user = await getCurrentUser();
  if (!user) return back("/login");
  const t = await getTranslations("templates.errors");
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX + 1024 * 1024) return back("/templates", t("fileTooLarge"));
  const file = (await request.formData()).get("package");
  if (!(file instanceof File) || file.size === 0) return back("/templates", t("chooseZip"));
  if (file.size > MAX) return back("/templates", t("fileTooLarge"));
  try {
    const files = unzipTemplatePackage(new Uint8Array(await file.arrayBuffer()));
    const { row } = await importTemplate({
      db: getDb(),
      storage: getStorage(),
      actor: user.actor,
      files,
    });
    await enqueueTemplateValidation(user, row.id);
    return back(`/templates/${row.id}`);
  } catch (err) {
    if (
      err instanceof ForgecyError ||
      (err instanceof Error && err.name === "PermissionDeniedError")
    )
      return back("/templates", (await errorMessage(err)) ?? err.message);
    if (err instanceof Error && /zip|invalid/i.test(err.message))
      return back("/templates", t("unreadableZip"));
    throw err;
  }
}
