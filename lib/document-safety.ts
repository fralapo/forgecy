import { inflateRawSync } from "node:zlib";

export const MAX_UPLOAD_BYTES = 10_000_000;
export const MAX_DOCX_ENTRIES = 400;
export const MAX_DOCX_EXPANDED = 64 * 1024 * 1024;
export const MAX_DOCX_ENTRY_BYTES = 24 * 1024 * 1024;
export const MAX_DOCX_RATIO = 250;

export class DocumentSafetyError extends Error {
  constructor(message: string) { super(message); this.name = "DocumentSafetyError"; }
}
function reject(message: string): never { throw new DocumentSafetyError(message); }

const mimeForExtension: Record<string, string[]> = {
  txt: ["text/plain"], md: ["text/markdown", "text/plain"],
  csv: ["text/csv", "text/plain"], pdf: ["application/pdf"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  png: ["image/png"], jpg: ["image/jpeg"], jpeg: ["image/jpeg"], webp: ["image/webp"]
};

export function validateUploadType(name: string, mime: string, length: number): string {
  if (!Number.isInteger(length) || length < 1 || length > MAX_UPLOAD_BYTES)
    reject("Il documento è vuoto o supera il limite di 10 MB");
  const ext = name.toLowerCase().split(".").pop() || "";
  if (!mimeForExtension[ext]?.includes(mime))
    reject("Estensione e tipo MIME del documento non corrispondono");
  return ext;
}

/**
 * Fail-closed OOXML ZIP preflight before Mammoth touches untrusted input.
 * Checks real decompressed bytes with a per-entry maxOutputLength; central-directory
 * claims alone are not trusted. Does not replace sandboxing or malware scanning.
 * ZIP64, multi-disk, encrypted archives and unsupported compression are rejected.
 */
export function inspectDocxArchive(bytes: Uint8Array): { entries: number; expandedBytes: number } {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data.length < 22 || data.readUInt32LE(0) !== 0x04034b50)
    reject("Archivio DOCX non valido");
  const end = data.length - 22;
  let eocd = -1;
  for (let i = end; i >= Math.max(0, end - 65535); i--) {
    if (data.readUInt32LE(i) === 0x06054b50 &&
        i + 22 + data.readUInt16LE(i + 20) === data.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) reject("Directory ZIP mancante o non integra");
  const disk = data.readUInt16LE(eocd + 4);
  const centralDisk = data.readUInt16LE(eocd + 6);
  const entriesOnDisk = data.readUInt16LE(eocd + 8);
  const count = data.readUInt16LE(eocd + 10);
  const directorySize = data.readUInt32LE(eocd + 12);
  const directoryOffset = data.readUInt32LE(eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== count ||
      count < 3 || count > MAX_DOCX_ENTRIES || count === 0xffff ||
      directorySize === 0xffffffff || directoryOffset === 0xffffffff ||
      directoryOffset + directorySize > eocd)
    reject("Struttura ZIP non supportata o archivio troppo complesso");

  const names = new Set<string>();
  const spans: Array<{ start: number; end: number }> = [];
  let offset = directoryOffset;
  let expandedBytes = 0;
  let contentTypes = "";
  for (let i = 0; i < count; i++) {
    if (offset + 46 > eocd || data.readUInt32LE(offset) !== 0x02014b50)
      reject("Indice ZIP danneggiato");
    const flags = data.readUInt16LE(offset + 8);
    const method = data.readUInt16LE(offset + 10);
    const compressed = data.readUInt32LE(offset + 20);
    const uncompressed = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const volume = data.readUInt16LE(offset + 34);
    const attrs = data.readUInt32LE(offset + 38);
    const localOffset = data.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > directoryOffset + directorySize || compressed === 0xffffffff ||
        uncompressed === 0xffffffff || localOffset === 0xffffffff || volume !== 0 ||
        (flags & (1 | 0x40 | 0x2000)) !== 0 || (method !== 0 && method !== 8))
      reject("ZIP cifrato, non supportato o malformato");
    const nameBytes = data.subarray(offset + 46, offset + 46 + nameLength);
    const name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
    const normalized = name.toLowerCase();
    if (!name || name.includes("\\") || name.includes("\0") ||
        name.startsWith("/") || /^[a-z]:/i.test(name) ||
        name.split("/").some(piece => piece === ".." || piece === ".") ||
        names.has(normalized) || normalized.startsWith("word/activex/") ||
        normalized.startsWith("word/embeddings/") ||
        normalized.includes("vbaproject") || /\.(?:exe|dll|js|vbs|ps1)$/i.test(name))
      reject("DOCX contiene percorsi duplicati o contenuti non consentiti");
    names.add(normalized);
    // Reject entries marked as Unix symbolic links.
    if (((attrs >>> 16) & 0xf000) === 0xa000)
      reject("DOCX contiene collegamenti simbolici");
    if (uncompressed > MAX_DOCX_ENTRY_BYTES ||
        expandedBytes + uncompressed > MAX_DOCX_EXPANDED ||
        (compressed === 0 ? uncompressed !== 0 :
        uncompressed > compressed * MAX_DOCX_RATIO))
      reject("DOCX espande troppi dati: possibile archivio compresso malevolo");

    if (localOffset + 30 > directoryOffset ||
        data.readUInt32LE(localOffset) !== 0x04034b50 ||
        data.readUInt16LE(localOffset + 8) !== method)
      reject("Intestazione ZIP locale non valida");
    const localNameLength = data.readUInt16LE(localOffset + 26);
    const localExtraLength = data.readUInt16LE(localOffset + 28);
    const localNameStart = localOffset + 30;
    const firstByte = localNameStart + localNameLength + localExtraLength;
    const lastByte = firstByte + compressed;
    if (lastByte > directoryOffset ||
        !data.subarray(localNameStart, localNameStart + localNameLength).equals(nameBytes) ||
        (method === 0 && compressed !== uncompressed))
      reject("File ZIP locale non corrispondente alla directory");
    spans.push({ start: localOffset, end: lastByte });
    // Limit actual inflation rather than relying on claimed sizes.
    try {
      const raw = data.subarray(firstByte, lastByte);
      const output = method === 8
        ? inflateRawSync(raw, { maxOutputLength: Math.min(MAX_DOCX_ENTRY_BYTES, uncompressed) + 1 })
        : raw;
      if (output.length !== uncompressed)
        reject("Dimensioni di decompressione ZIP non coerenti");
      if (normalized === "[content_types].xml") contentTypes = output.toString("utf8");
    } catch (e) {
      if (e instanceof DocumentSafetyError) throw e;
      reject("Decompressione DOCX non valida o eccedente i limiti");
    }
    expandedBytes += uncompressed;
    offset = next;
  }
  if (offset !== directoryOffset + directorySize)
    reject("Indice ZIP contiene dati imprevisti");
  spans.sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++)
    if (spans[i].start < spans[i - 1].end)
      reject("Voci ZIP sovrapposte");
  if (!names.has("[content_types].xml") || !names.has("word/document.xml") ||
      !names.has("_rels/.rels") || /macroenabled|activex|vbaproject/i.test(contentTypes))
    reject("Il file non è un documento DOCX standard senza macro");
  return { entries: count, expandedBytes };
}

/** Validate content before a client file is stored, and again before extraction. */
export function assertSafeDocument(bytes: Uint8Array, mime: string, name: string): void {
  const ext = validateUploadType(name, mime, bytes.byteLength);
  if (ext === "docx") { inspectDocxArchive(bytes); return; }
  if (ext === "pdf") {
    const head = Buffer.from(bytes.subarray(0, 5)).toString("ascii");
    if (head !== "%PDF-") reject("Il file non ha una intestazione PDF valida");
    if (!Buffer.from(bytes.subarray(Math.max(0, bytes.byteLength - 2048))).includes(Buffer.from("%%EOF")))
      reject("Il PDF non contiene un terminatore valido");
    return;
  }
  if (["txt", "md", "csv"].includes(ext)) {
    if (bytes.includes(0)) reject("Un file di testo contiene dati binari");
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { reject("Il documento di testo non è UTF-8 valido"); }
    return;
  }
  if (ext === "png" &&
      (bytes.length < 8 || !Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137,80,78,71,13,10,26,10]))))
    reject("Il file non è una immagine PNG valida");
  if (["jpg", "jpeg"].includes(ext) &&
      (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255))
    reject("Il file non è una immagine JPEG valida");
  if (ext === "webp" &&
      (bytes.length < 12 || Buffer.from(bytes.subarray(0,4)).toString("ascii") !== "RIFF" ||
      Buffer.from(bytes.subarray(8,12)).toString("ascii") !== "WEBP"))
    reject("Il file non è una immagine WEBP valida");
}
