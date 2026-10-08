import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Constant-time check of the first-run token; true when none is configured. */
export function setupTokenOk(expected: string | undefined, given: string): boolean {
  if (!expected) return true;
  return timingSafeEqual(digest(expected), digest(given));
}
