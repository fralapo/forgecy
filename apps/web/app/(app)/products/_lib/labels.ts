import type {
  ConfidenceLevel,
  ImportItemStatus,
  ProductImportStatus,
  ProductStatus,
} from "@forgecy/core";

export const productStatusLabels: Record<ProductStatus, string> = {
  draft: "Draft",
  proposed: "Proposed",
  approved: "Approved",
  rejected: "Rejected",
  archived: "Archived",
};

export const importStatusLabels: Record<ProductImportStatus, string> = {
  uploading: "Uploading",
  analyzing: "Analyzing",
  needs_mapping: "Needs mapping",
  ready_for_review: "To review",
  completed: "Completed",
  partial: "Partially completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const itemStatusLabels: Record<ImportItemStatus, string> = {
  pending: "Undecided",
  accepted: "Accepted (Proposed)",
  approved: "Approved",
  merged: "Merged",
  discarded: "Rejected",
};

export const confidenceText: Record<ConfidenceLevel, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const sourceFilterLabels = {
  csv: "CSV/XLSX",
  manual: "Manual",
  pdf: "PDF",
  zip: "ZIP",
  image: "Image",
} as const;

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** “today 10:42”, “3 October”, used for last-modified and import names. */
export function shortWhen(d: Date): string {
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `today ${timeFmt.format(d)}`;
  return dateFmt.format(d);
}

export function longDate(d: Date): string {
  return `${dayFmt.format(d)} ${timeFmt.format(d)}`;
}

export function importTitle(createdAt: Date): string {
  return `Import of ${dateFmt.format(createdAt)}`;
}

const usd = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
export function formatUsd(v: number): string {
  return usd.format(v);
}

const bytes = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${bytes.format(n / 1024)} KB`;
  return `${bytes.format(n / 1024 / 1024)} MB`;
}

export const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
