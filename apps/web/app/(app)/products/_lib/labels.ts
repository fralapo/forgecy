import type {
  ConfidenceLevel,
  ImportItemStatus,
  ProductImportStatus,
  ProductStatus,
} from "@forgecy/core";

export const productStatusLabels: Record<ProductStatus, string> = {
  draft: "Bozza",
  proposed: "Proposto",
  approved: "Approvato",
  rejected: "Rifiutato",
  archived: "Archiviato",
};

export const importStatusLabels: Record<ProductImportStatus, string> = {
  uploading: "Caricamento",
  analyzing: "Analisi in corso",
  needs_mapping: "Serve la mappatura",
  ready_for_review: "Da rivedere",
  completed: "Completato",
  partial: "Completato in parte",
  failed: "Non riuscito",
  cancelled: "Annullato",
};

export const itemStatusLabels: Record<ImportItemStatus, string> = {
  pending: "Da decidere",
  accepted: "Accettato (Proposto)",
  approved: "Approvato",
  merged: "Unito",
  discarded: "Scartato",
};

export const confidenceText: Record<ConfidenceLevel, string> = {
  high: "Alta",
  medium: "Media",
  low: "Bassa",
};

export const sourceFilterLabels = {
  csv: "CSV/XLSX",
  manual: "Manuale",
  pdf: "PDF",
  zip: "ZIP",
  image: "Immagine",
} as const;

const dateFmt = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long" });
const timeFmt = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("it-IT", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** «oggi 10:42», «3 ottobre», used for last-modified and import names. */
export function shortWhen(d: Date): string {
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `oggi ${timeFmt.format(d)}`;
  return dateFmt.format(d);
}

export function longDate(d: Date): string {
  return `${dayFmt.format(d)} ${timeFmt.format(d)}`;
}

export function importTitle(createdAt: Date): string {
  return `Import del ${dateFmt.format(createdAt)}`;
}

const usd = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
export function formatUsd(v: number): string {
  return usd.format(v);
}

const bytes = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${bytes.format(n / 1024)} KB`;
  return `${bytes.format(n / 1024 / 1024)} MB`;
}

export const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString("it-IT")} ${n === 1 ? one : many}`;
