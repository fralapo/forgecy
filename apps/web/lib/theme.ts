import "server-only";
import { cookies } from "next/headers";

/** Interface theme the person chose on this browser; no cookie follows the operating system. */
export const THEME_COOKIE = "forgecy-theme";
export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const isTheme = (value: unknown): value is Theme =>
  typeof value === "string" && (THEMES as readonly string[]).includes(value);

export async function getTheme(): Promise<Theme | null> {
  const value = (await cookies()).get(THEME_COOKIE)?.value;
  return isTheme(value) ? value : null;
}
