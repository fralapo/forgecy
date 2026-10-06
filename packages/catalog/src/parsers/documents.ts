import mammoth from "mammoth";
import { ImportError } from "../import/errors";
import { IMPORT_LIMITS } from "../import/limits";
import { decodeCsv } from "./sheet";
import { assertSafeOfficeFile } from "./zip";

/** Plain text of a TXT/MD or DOCX file. */
export async function readTextDocument(
  data: Buffer,
  name: string,
  format: "txt" | "docx",
): Promise<string> {
  let text: string;
  if (format === "docx") {
    await assertSafeOfficeFile(data, name);
    try {
      text = (await mammoth.extractRawText({ buffer: data })).value;
    } catch {
      throw new ImportError("IMPORT-INVALID", `"${name}" is not a readable DOCX.`);
    }
  } else {
    try {
      text = decodeCsv(data).text;
    } catch {
      throw new ImportError("IMPORT-INVALID", `"${name}" is not readable text.`);
    }
  }
  text = text
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > IMPORT_LIMITS.textBytes ? text.slice(0, IMPORT_LIMITS.textBytes) : text;
}

/**
 * A product text file is often "Label: value" lines. Read the labels we know; the
 * rest becomes the long description. No AI needed.
 */
export function parseProductText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const rest: string[] = [];
  // Labels match Italian and English product sheets.
  const labels: Array<[RegExp, string]> = [
    [/^(nome|name|prodotto|titolo)$/i, "name"],
    [/^(sku|codice|cod|codice articolo|code)$/i, "sku"],
    [/^(categoria|category)$/i, "category"],
    [/^(descrizione breve|short description|sommario)$/i, "shortDescription"],
    [/^(descrizione|description)$/i, "longDescription"],
    [/^(ingredienti|materiali|composizione|ingredients|materials|inci)$/i, "materials"],
    [/^(formato|formati|formats?|taglia|contenuto)$/i, "formats"],
    [/^(modo d'uso|istruzioni|istruzioni d'uso|modalità d'uso|how to use|usage)$/i, "usage"],
    [/^(caratteristiche|features|specifiche)$/i, "features"],
    [/^(benefici|vantaggi|benefits)$/i, "benefits"],
    [/^(prezzo|price)$/i, "price"],
    [/^(valuta|currency)$/i, "currency"],
    [/^(tag|tags)$/i, "tags"],
  ];
  let current: string | null = null;
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([^:]{2,40}):\s*(.*)$/);
    const key = m ? labels.find(([re]) => re.test(m[1]!.trim()))?.[1] : undefined;
    if (m && key) {
      current = key;
      out[key] = m[2]!.trim();
    } else if (current && line.trim()) {
      out[current] = `${out[current] ? `${out[current]}\n` : ""}${line.trim()}`;
    } else {
      current = null;
      if (line.trim()) rest.push(line.trim());
    }
  }
  if (rest.length) {
    const body = rest.join("\n");
    if (!out.longDescription) out.longDescription = body;
    else out.longDescription += `\n${body}`;
  }
  return out;
}
