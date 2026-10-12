const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Short random id for items inside a Brand Identity document (stable across versions). */
export function newItemId(length = 10): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}
