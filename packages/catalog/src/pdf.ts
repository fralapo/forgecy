import { extractText, getDocumentProxy } from "unpdf";
import { ImportError } from "./errors";
import { IMPORT_LIMITS } from "./limits";

export interface PdfText {
  totalPages: number;
  /** Text per page (index 0 = page 1), whitespace normalized. */
  pages: string[];
  /** True when there is (almost) no selectable text: a scan. */
  textless: boolean;
}

/**
 * Text of a client PDF, page by page. pdf.js 5 has no eval path and runs without font
 * loading or scripts here: the PDF is only read as data. Password-protected files fail with
 * IMPORT-PDF-UNREADABLE.
 */
export async function readPdfText(data: Uint8Array, name: string): Promise<PdfText> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(data), {
      disableFontFace: true,
      useSystemFonts: false,
      stopAtErrors: false,
    });
  } catch (err) {
    const n = err instanceof Error ? err.name : "";
    throw new ImportError(
      "IMPORT-PDF-UNREADABLE",
      n === "PasswordException"
        ? `"${name}" is password-protected. Upload a version without a password.`
        : `"${name}" is not a readable PDF.`,
    );
  }
  try {
    if (pdf.numPages > IMPORT_LIMITS.pdfPages)
      throw new ImportError(
        "IMPORT-TOO-LARGE",
        `"${name}" has ${pdf.numPages} pages: the limit is ${IMPORT_LIMITS.pdfPages}. Split the file.`,
      );
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = (text as string[]).map((t) =>
      t
        .replace(/[ \t\u00a0]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    );
    const chars = pages.reduce((n, p) => n + p.replace(/\s/g, "").length, 0);
    return { totalPages, pages, textless: chars < Math.max(10, totalPages * 8) };
  } catch (err) {
    if (err instanceof ImportError) throw err;
    throw new ImportError("IMPORT-PDF-UNREADABLE", `"${name}" is not a readable PDF.`);
  } finally {
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}

/**
 * Group pages into chunks under the per-request character budget, keeping page
 * boundaries so every extracted field can cite its page.
 */
export function chunkPages(
  pages: string[],
  maxChars: number = IMPORT_LIMITS.pdfChunkChars,
): Array<{ from: number; to: number; text: string }> {
  const chunks: Array<{ from: number; to: number; text: string }> = [];
  let cur: { from: number; to: number; parts: string[]; size: number } | null = null;
  pages.forEach((raw, i) => {
    const page = i + 1;
    const text = raw.length > maxChars ? raw.slice(0, maxChars) : raw;
    if (!text.trim()) return;
    const block = `<page number="${page}">\n${text}\n</page>`;
    if (cur && cur.size + block.length > maxChars) {
      chunks.push({ from: cur.from, to: cur.to, text: cur.parts.join("\n") });
      cur = null;
    }
    cur ??= { from: page, to: page, parts: [], size: 0 };
    cur.parts.push(block);
    cur.to = page;
    cur.size += block.length;
  });
  if (cur) {
    const c = cur as { from: number; to: number; parts: string[] };
    chunks.push({ from: c.from, to: c.to, text: c.parts.join("\n") });
  }
  return chunks;
}
