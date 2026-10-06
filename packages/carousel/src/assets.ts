import { ForgecyError } from "@forgecy/core";
import type { StorageDriver } from "@forgecy/files";
import type { BrandTheme } from "./brand";
import { dataUrl } from "./package";
import type { Slide } from "./slide-schema";

const MAX_ASSET_BYTES = 25 * 1024 * 1024;

function sniff(b: Uint8Array): string | undefined {
  const at = (o: number, sig: number[]) => sig.every((v, i) => b[o + i] === v);
  if (at(0, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  if (at(0, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  const head = new TextDecoder().decode(b.slice(0, 4));
  if (head === "wOF2") return "font/woff2";
  if (head === "wOFF") return "font/woff";
  if (head === "OTTO") return "font/otf";
  if (at(0, [0, 1, 0, 0])) return "font/ttf";
  const text = new TextDecoder().decode(b.slice(0, 512)).trimStart();
  if (text.startsWith("<svg") || (text.startsWith("<?xml") && text.includes("<svg")))
    return "image/svg+xml";
  return undefined;
}

/** Storage keys a carousel needs: slide images, logo, brand fonts. */
export function collectAssetKeys(slides: Slide[], brand: BrandTheme): string[] {
  const keys = new Set<string>();
  for (const s of slides)
    for (const v of Object.values(s.slots))
      if (v && typeof v === "object" && !Array.isArray(v) && v.key) keys.add(v.key);
  if (brand.logo?.key) keys.add(brand.logo.key);
  for (const f of Object.values(brand.fonts)) if (f?.key) keys.add(f.key);
  return [...keys].sort();
}

/**
 * Read assets from storage as data URLs. Only the client's own files (and agency-wide
 * `system/` files) are allowed: a slide can never pull another client's asset.
 */
export async function resolveAssets(
  storage: StorageDriver,
  clientId: string,
  keys: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const key of keys) {
    if (!key.startsWith(`clients/${clientId}/`) && !key.startsWith("system/"))
      throw new ForgecyError("permission_denied", `Asset di un altro cliente: ${key}`);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of await storage.get(key)) {
      const c = chunk as Uint8Array;
      size += c.length;
      if (size > MAX_ASSET_BYTES)
        throw new ForgecyError("validation", `Asset troppo grande: ${key}`);
      chunks.push(c);
    }
    const bytes = new Uint8Array(Buffer.concat(chunks));
    const mime = sniff(bytes);
    if (!mime) throw new ForgecyError("validation", `Formato non riconosciuto: ${key}`);
    out.set(key, dataUrl(bytes, mime));
  }
  return out;
}
