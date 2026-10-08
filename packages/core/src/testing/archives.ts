/**
 * Hostile-archive builders for tests. Everything is generated in memory, so no binary
 * fixture is ever committed. Node built-ins only; import from tests, never from app code.
 */
import { crc32, deflateRawSync, gzipSync } from "node:zlib";

export interface ZipEntrySpec {
  name: string;
  data?: Buffer | string;
  /** Store without compression (method 0). */
  store?: boolean;
  /** Written in the local header and the central directory instead of the real size (a lie). */
  declaredSize?: number;
  /** Unix type and mode (upper 16 bits of the external attributes): 0o120777 is a symlink. */
  unixMode?: number;
  /** Sets the "encrypted" flag; readers must refuse the entry. */
  encrypted?: boolean;
}

const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};

/** A ZIP with fewer than 65 536 entries (the end record uses 16-bit counts). */
export function zipArchive(entries: readonly ZipEntrySpec[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.from(e.data ?? "");
    const body = e.store ? raw : deflateRawSync(raw);
    const name = Buffer.from(e.name, "utf8");
    const common = [
      u16(20),
      u16(0x0800 | (e.encrypted ? 1 : 0)),
      u16(e.store ? 0 : 8),
      u16(0),
      u16(0x21),
      u32(crc32(raw)),
      u32(body.length),
      u32(e.declaredSize ?? raw.length),
      u16(name.length),
    ];
    const local = Buffer.concat([u32(0x04034b50), ...common, u16(0), name, body]);
    centrals.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(0x031e),
        ...common,
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(((e.unixMode ?? 0o100644) << 16) >>> 0),
        u32(offset),
        name,
      ]),
    );
    locals.push(local);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(cd.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, cd, end]);
}

export interface TarEntrySpec {
  name: string;
  type?: "file" | "dir" | "symlink" | "hardlink" | "char";
  data?: Buffer | string;
  linkName?: string;
}

const TYPEFLAG = { file: "0", dir: "5", symlink: "2", hardlink: "1", char: "3" } as const;

/** A gzip-compressed ustar archive. Names must fit in 100 bytes. */
export function tarGz(entries: readonly TarEntrySpec[]): Buffer {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const type = e.type ?? "file";
    const data = type === "file" ? Buffer.from(e.data ?? "") : Buffer.alloc(0);
    if (Buffer.byteLength(e.name) > 100) throw new Error("tar fixture: name over 100 bytes");
    const h = Buffer.alloc(512);
    h.write(e.name, 0, "utf8");
    h.write((type === "dir" ? "0000755" : "0000644") + "\0", 100);
    h.write("0000000\0", 108);
    h.write("0000000\0", 116);
    h.write(data.length.toString(8).padStart(11, "0") + "\0", 124);
    h.write("00000000000\0", 136);
    h.fill(" ", 148, 156);
    h.write(TYPEFLAG[type], 156);
    if (e.linkName) h.write(e.linkName, 157, "utf8");
    h.write("ustar\x0000", 257);
    h.write(
      h
        .reduce((n, b) => n + b, 0)
        .toString(8)
        .padStart(6, "0") + "\0 ",
      148,
    );
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

/** A valid PDF whose page tree has `pages` pages that all share one empty content stream. */
export function pdfWithPages(pages: number): Buffer {
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${4 + i} 0 R`).join(" ")}] /Count ${pages} >>`;
  objects[3] = "<< /Length 0 >>\nstream\n\nendstream";
  for (let i = 0; i < pages; i++)
    objects[4 + i] =
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Contents 3 0 R /Resources << >> >>";
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(out, "latin1");
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++)
    out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
