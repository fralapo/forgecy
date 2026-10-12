import "server-only";
import { isLocale, type Actor, type Locale } from "@forgecy/core";
import { clientScopeOf, getDb } from "@forgecy/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { maintenanceFor } from "./maintenance";
import { cache } from "react";
import { auth } from "./auth";
import { env } from "./env";

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

/** Open mode (single admin, no sign-in): the oldest active admin acts for everyone who reaches the app. */
async function sessionUser() {
  if (env.FORGECY_AUTH_MODE === "open")
    return (
      (await getDb().query.users.findFirst({
        where: (u, { and, eq }) => and(eq(u.isAdmin, true), eq(u.active, true)),
        orderBy: (u, { asc }) => asc(u.createdAt),
      })) ?? null
    );
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user.active ? session.user : null;
}

/**
 * The signed-in user, validated against the database (the proxy only checks the cookie).
 * Cached per request: pages and the i18n request config share one lookup. The actor carries
 * the clients the person may open (ADR 0020), read here once per request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const user = await sessionUser();
  if (!user) return null;
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
