import "server-only";
import { isLocale, type Actor, type Locale } from "@forgecy/core";
import { clientScopeOf, getDb } from "@forgecy/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { maintenanceFor } from "./maintenance";
import { cache } from "react";
import { auth } from "./auth";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  isProductOwner: boolean;
  /** Interface language the person chose; null follows the browser. */
  locale: Locale | null;
  actor: Actor;
};

/**
 * The signed-in user, validated against the database (the proxy only checks the cookie).
 * Cached per request: pages and the i18n request config share one lookup. The actor carries
 * the clients the person may open (ADR 0020), read here once per request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !session.user.active) return null;
  const { user } = session;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isAdmin: user.isAdmin,
    isProductOwner: user.isProductOwner,
    locale: isLocale(user.locale) ? user.locale : null,
    actor: {
      type: "user",
      id: user.id,
      isAdmin: user.isAdmin,
      active: user.active,
      clients: await clientScopeOf(getDb(), user),
    },
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // During a restore pages and actions send everyone but its Admin to the 503 page.
  if (await maintenanceFor(user)) redirect("/maintenance");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.isAdmin) redirect("/");
  return user;
}
