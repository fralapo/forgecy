import writeXlsxFile from "write-excel-file/node";
import yazl from "yazl";

/** Build a ZIP in memory. `store: true` keeps an entry uncompressed. */
export function makeZip(
  entries: Array<{ path: string; data: Buffer | string; store?: boolean }>,
): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  for (const e of entries)
    zip.addBuffer(Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data), e.path, {
      compress: !e.store,
    });
  zip.end();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (c: Buffer) => chunks.push(c));
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on("error", reject);
  });
}

export function makeXlsx(rows: Array<Array<string | number | null>>): Promise<Buffer> {
  return writeXlsxFile(rows).toBuffer();
}

/** A tiny but valid text PDF, one page per entry, lines split on "\n". */
export function makePdf(pages: string[]): Buffer {
  const objects: string[] = [];
  const pageIds: number[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let next = 4;
  for (const text of pages) {
    const lines = text.split("\n").map((l) => l.replace(/[\\()]/g, (m) => `\\${m}`));
    const stream = `BT /F1 11 Tf 14 TL 50 780 Td ${lines.map((l) => `(${l}) Tj T*`).join(" ")} ET`;
    const contentId = next++;
    const pageId = next++;
    objects[contentId] =
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    pageIds.push(pageId);
  }
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
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

/** 1×1 PNG. */
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
/** Distinct PNGs (different bytes → different sha256). */
export function png(n: number): Buffer {
  return Buffer.concat([PNG, Buffer.from(`#${n}`)]);
}
