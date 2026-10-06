import { type Zippable, zipSync } from "fflate";
import { PDFDocument } from "pdf-lib";

/**
 * PDF and ZIP built so the same input gives the same bytes: fixed dates taken from
 * the approval (not "now"), sorted entries, no random ids.
 */
export interface PdfMeta {
  title: string;
  author: string;
  subject: string;
  keywords: string[];
  date: Date;
  /** BCP 47 tag of the deliverable's language (en-GB, it-IT). */
  language?: string;
}

/**
 * One page per slide holding the same PNG as the export. The page size is in points:
 * the slide's pixel size, or the real print size for formats with a dpi (see pdfPageSize).
 */
export async function pngsToPdf(
  pngs: Uint8Array[],
  width: number,
  height: number,
  meta: PdfMeta,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(meta.title, { showInWindowTitleBar: true });
  doc.setAuthor(meta.author);
  doc.setSubject(meta.subject);
  doc.setKeywords(meta.keywords);
  doc.setCreator("Forgecy");
  doc.setProducer("Forgecy");
  // Language of the deliverable copy (English by default).
  doc.setLanguage(meta.language ?? "en-GB");
  doc.setCreationDate(meta.date);
  doc.setModificationDate(meta.date);
  for (const png of pngs) {
    const image = await doc.embedPng(png);
    const page = doc.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });
  }
  return doc.save({ useObjectStreams: false });
}

/** DOS timestamps are local time: build the Date from the wanted UTC fields so the TZ never leaks in. */
export function zipDate(iso?: string): Date {
  const d = iso ? new Date(iso) : new Date(Date.UTC(2000, 0, 1));
  return new Date(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
  );
}

export function buildZip(entries: { name: string; data: Uint8Array }[], date: Date): Uint8Array {
  const files: Zippable = {};
  for (const e of entries) {
    // PNG and PDF are already compressed.
    const stored = /\.(png|pdf)$/.test(e.name);
    files[e.name] = [e.data, { level: stored ? 0 : 6, mtime: date }];
  }
  return zipSync(files, { mtime: date });
}
