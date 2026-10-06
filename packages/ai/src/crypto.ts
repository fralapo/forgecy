import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ForgecyError } from "@forgecy/core";

/**
 * AES-256-GCM for BYOK provider keys stored in ai_connections.encrypted_key.
 * Format: "v1:" + base64(iv[12] | tag[16] | ciphertext). The key comes from
 * FORGECY_ENCRYPTION_KEY (base64, 32 bytes) and never lives in the database.
 */
const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function parseEncryptionKey(base64Key: string | undefined): Buffer {
  if (!base64Key) throw new ForgecyError("unavailable", "FORGECY_ENCRYPTION_KEY is not set");
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32)
    throw new ForgecyError(
      "unavailable",
      "FORGECY_ENCRYPTION_KEY must be 32 bytes encoded in base64",
    );
  return key;
}

export function encryptSecret(
  plaintext: string,
  base64Key: string | undefined,
  aad = "forgecy:ai_connections",
): string {
  const key = parseEncryptionKey(base64Key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")}`;
}

export function decryptSecret(
  payload: string,
  base64Key: string | undefined,
  aad = "forgecy:ai_connections",
): string {
  const key = parseEncryptionKey(base64Key);
  const [version, body] = payload.split(":", 2);
  if (version !== VERSION || !body)
    throw new ForgecyError("validation", "Unsupported encrypted secret format");
  const raw = Buffer.from(body, "base64");
  if (raw.length < IV_BYTES + TAG_BYTES)
    throw new ForgecyError("validation", "Encrypted secret is truncated");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_BYTES));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  try {
    return Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new ForgecyError(
      "validation",
      "Encrypted secret could not be decrypted (wrong key or tampered data)",
    );
  }
}

/** Last four characters, the only part of a key ever shown in the UI. */
export function keyHint(secret: string): string {
  return secret.slice(-4);
}

/** Generate a fresh FORGECY_ENCRYPTION_KEY value. */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString("base64");
}
