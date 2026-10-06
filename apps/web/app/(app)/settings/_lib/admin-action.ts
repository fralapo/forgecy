import "server-only";
import { assertCan, PermissionDeniedError, type Permission } from "@forgecy/core";
import { getTranslations } from "next-intl/server";
import { requireUser, type CurrentUser } from "@/lib/session";

export type AdminActionResult =
  { ok: true; message: string } | { ok: false; error: string; code?: string };

export async function deniedResult(): Promise<AdminActionResult> {
  return {
    ok: false,
    error: (await getTranslations("admin"))("adminOnly"),
    code: "PERM-DENIED",
  };
}

/** The signed-in Admin holding `permission`, or the PERM-DENIED result to return as is. */
export async function requireAdminAction(
  permission: Permission,
): Promise<
  { user: CurrentUser; denied?: undefined } | { user?: undefined; denied: AdminActionResult }
> {
  const user = await requireUser();
  try {
    assertCan(user.actor, permission);
    return { user };
  } catch (err) {
    if (!(err instanceof PermissionDeniedError)) throw err;
    return { denied: await deniedResult() };
  }
}
