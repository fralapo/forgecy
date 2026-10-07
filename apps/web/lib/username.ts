/**
 * People sign in with a username. Better Auth keys accounts by email, so a bare username is stored
 * as `<username>@forgecy.local`, an address that never receives mail. A full email passes through.
 */
const LOCAL_DOMAIN = "@forgecy.local";

export function usernameToEmail(username: string): string {
  const id = username.trim().toLowerCase();
  return id.includes("@") ? id : id + LOCAL_DOMAIN;
}

export function emailToUsername(email: string): string {
  return email.endsWith(LOCAL_DOMAIN) ? email.slice(0, -LOCAL_DOMAIN.length) : email;
}
