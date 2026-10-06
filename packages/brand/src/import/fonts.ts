/** Family name from a font file's `name` table (TTF, OTF, WOFF). WOFF2 falls back to the file name. */
import { unzlibSync } from "fflate";

const u16 = (b: DataView, o: number) => b.getUint16(o);
const u32 = (b: DataView, o: number) => b.getUint32(o);
const tag = (b: Uint8Array, o: number) => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);

function nameTable(bytes: Uint8Array): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sig = tag(bytes, 0);
  if (sig === "wOFF") {
    const numTables = u16(view, 12);
    for (let i = 0; i < numTables; i++) {
      const o = 44 + i * 20;
      if (tag(bytes, o) !== "name") continue;
      const offset = u32(view, o + 4);
      const compLength = u32(view, o + 8);
      const origLength = u32(view, o + 12);
      const data = bytes.subarray(offset, offset + compLength);
      return compLength < origLength ? unzlibSync(data) : data;
    }
    return null;
  }
  if (sig !== "OTTO" && sig !== "true" && u32(view, 0) !== 0x00010000) return null;
  const numTables = u16(view, 4);
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    if (tag(bytes, o) !== "name") continue;
    const offset = u32(view, o + 8);
    const length = u32(view, o + 12);
    return bytes.subarray(offset, offset + length);
  }
  return null;
}

export interface FontNames {
  family: string;
  subfamily?: string;
}

export function readFontNames(bytes: Uint8Array): FontNames | null {
  let table: Uint8Array | null;
  try {
    table = nameTable(bytes);
  } catch {
    return null;
  }
  if (!table || table.byteLength < 6) return null;
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const count = u16(view, 2);
  const storage = u16(view, 4);
  const found = new Map<number, string>();
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    if (r + 12 > table.byteLength) break;
    const platform = u16(view, r);
    const nameId = u16(view, r + 6);
    const length = u16(view, r + 8);
    const offset = u16(view, r + 10);
    if (![1, 2, 16, 17].includes(nameId)) continue;
    const raw = table.subarray(storage + offset, storage + offset + length);
    let s: string;
    if (platform === 3 || platform === 0) {
      s = "";
      for (let j = 0; j + 1 < raw.length; j += 2) s += String.fromCharCode((raw[j]! << 8) | raw[j + 1]!);
    } else s = String.fromCharCode(...raw);
    s = s.replace(/\0/g, "").trim();
    // Prefer Windows/Unicode entries, which come with proper encodings.
    if (s && (!found.has(nameId) || platform === 3)) found.set(nameId, s);
  }
  const family = found.get(16) ?? found.get(1);
  if (!family) return null;
  const subfamily = found.get(17) ?? found.get(2);
  return { family, ...(subfamily ? { subfamily } : {}) };
}

/** "Montserrat-SemiBold.woff2" → "Montserrat". */
export function familyFromFileName(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, "");
  return (
    base
      .replace(/[-_ ]?(thin|extralight|light|regular|book|medium|semibold|demibold|bold|extrabold|black|heavy|italic|oblique|variable|vf|\d{3})+$/gi, "")
      .replace(/[-_]+/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .trim() || base
  );
}

const WEIGHTS: Array<[RegExp, number]> = [
  [/thin|hairline/i, 100],
  [/extra ?light|ultra ?light/i, 200],
  [/light/i, 300],
  [/semi ?bold|demi ?bold/i, 600],
  [/extra ?bold|ultra ?bold/i, 800],
  [/black|heavy/i, 900],
  [/bold/i, 700],
  [/medium/i, 500],
  [/regular|normal|book|roman/i, 400],
];

export function weightFromName(name: string | undefined): number | undefined {
  if (!name) return undefined;
  return WEIGHTS.find(([re]) => re.test(name))?.[1];
}
