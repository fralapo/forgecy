/**
 * People sign in with a username. Better Auth keys accounts by email, so a bare username is stored
 * as `<username>@forgecy.local`, an address that never receives mail. A full email passes through.
 */
import { z } from "zod";

const LOCAL_DOMAIN = "@forgecy.local";
const USERNAME = /^[A-Za-z0-9._-]+(@[A-Za-z0-9.-]+)?$/;

/**
 * A username an account may be created with: the allowed characters, and an address that
 * Better Auth's own sign-in check (z.email(), same zod) accepts. Without the second rule
 * "admin." created an account that could never sign in.
 */
export function isValidUsername(input: string): boolean {
  const id = input.trim();
  return USERNAME.test(id) && z.email().safeParse(usernameToEmail(id)).success;
}

export function usernameToEmail(username: string): string {
  const id = username.trim().toLowerCase();
  return id.includes("@") ? id : id + LOCAL_DOMAIN;
}

export function emailToUsername(email: string): string {
  return email.endsWith(LOCAL_DOMAIN) ? email.slice(0, -LOCAL_DOMAIN.length) : email;
}
