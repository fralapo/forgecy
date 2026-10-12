import { createHmac, timingSafeEqual } from "node:crypto";
import type { ContentDisposition } from "./driver";

/**
 * Signed URLs for the local disk driver. The web app's `/api/files/[...key]`
 * route calls `verifySignedFileUrl` before streaming the file.
 * Signature = HMAC-SHA256(secret, "<key>\n<exp>\n<disposition>\n<filename>"), base64url.
 */
function payload(key: string, exp: number, disposition = "", filename = ""): string {
  return `${key}\n${exp}\n${disposition}\n${filename}`;
}

export function signFileUrl(
  key: string,
  exp: number,
  secret: string,
  disposition?: ContentDisposition,
  filename?: string,
): string {
  return createHmac("sha256", secret)
    .update(payload(key, exp, disposition, filename))
    .digest("base64url");
}

export type SignatureCheck =
  { ok: true } | { ok: false; reason: "malformed" | "expired" | "bad_signature" };

/**
 * Verify a signed file URL. `exp` is unix seconds (as found in the `exp` query param).
 * Pass `disposition`/`filename` exactly as received in `disp`/`fn` query params.
 */
export function verifySignedFileUrl(
  key: string,
  exp: string | number | null | undefined,
  sig: string | null | undefined,
  secret: string,
  options: { disposition?: string | null; filename?: string | null; now?: Date } = {},
): SignatureCheck {
  if (!sig || exp === null || exp === undefined || exp === "")
    return { ok: false, reason: "malformed" };
  const expNum = typeof exp === "number" ? exp : Number(exp);
  if (!Number.isInteger(expNum) || expNum <= 0) return { ok: false, reason: "malformed" };
  const disposition = options.disposition ?? "";
  if (disposition !== "" && disposition !== "inline" && disposition !== "attachment") {
    return { ok: false, reason: "malformed" };
  }
  const expected = Buffer.from(
    createHmac("sha256", secret)
      .update(payload(key, expNum, disposition, options.filename ?? ""))
      .digest("base64url"),
  );
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad_signature" };
  }
  const nowSec = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (expNum < nowSec) return { ok: false, reason: "expired" };
  return { ok: true };
}

/**
 * Derive the file-URL signing key from the app secret so the raw auth secret is
 * never reused directly for another purpose.
 */
export function deriveFileSigningSecret(appSecret: string): string {
  return createHmac("sha256", appSecret).update("forgecy:file-urls:v1").digest("base64url");
}
