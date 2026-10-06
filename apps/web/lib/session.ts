import "server-only";
import type { Actor } from "@forgecy/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  isProductOwner: boolean;
  actor: Actor;
};

/** The signed-in user, validated against the database (the proxy only checks the cookie). */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !session.user.active) return null;
  const { user } = session;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isAdmin: user.isAdmin,
    isProductOwner: user.isProductOwner,
    actor: { type: "user", id: user.id, isAdmin: user.isAdmin, active: user.active },
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.isAdmin) redirect("/");
  return user;
}
