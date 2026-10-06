import type { ConfidenceLevel, ImageMatchMethod } from "@forgecy/core";
import { fieldKeys, isEmptyValue, type FieldKey, type ProductDraft } from "./fields";
import type { SourceRef } from "./meta";
import type { ClaimKind } from "./sensitive";
import { baseName, folderSegments, normalizeKey, normalizeSku } from "./text";

export interface ImageRef {
  fileId: string;
  method: ImageMatchMethod;
  confidence: ConfidenceLevel;
}

/** A product found by the import, before review. */
export interface Candidate {
  draft: ProductDraft;
  sources: Partial<Record<FieldKey, SourceRef>>;
  confidence: Partial<Record<FieldKey, ConfidenceLevel>>;
  images: ImageRef[];
  /** Main origin shown in the list ("PDF price list p. 7", "CSV row 42"). */
  origin: SourceRef;
  /** Image references from a sheet column (file names or URLs). */
  imageNames?: string[];
  /** Proposed by the Brand Analyst (AI extraction). */
  agent?: boolean;
  /** Claims flagged by the Brand Analyst, per field. */
  aiClaims?: Partial<Record<FieldKey, ClaimKind[]>>;
}

export function candidateKey(c: Pick<Candidate, "draft">): string | null {
  if (c.draft.sku) return `sku:${normalizeSku(c.draft.sku)}`;
  if (c.draft.name)
    return `name:${normalizeKey(c.draft.name)}|${normalizeKey(c.draft.category ?? "")}`;
  return null;
}

/**
 * Products from different sources join by SKU, then by name + category (page 73).
 * The first source keeps its values (sheets first, then texts and folders, then
 * PDFs); later sources only fill empty fields.
 */
export function mergeCandidates(list: Candidate[]): Candidate[] {
  const out: Candidate[] = [];
  const bySku = new Map<string, Candidate>();
  const byName = new Map<string, Candidate>();
  for (const c of list) {
    const sku = c.draft.sku ? normalizeSku(c.draft.sku) : "";
    const name = c.draft.name ? normalizeKey(c.draft.name) : "";
    const target =
      (sku && bySku.get(sku)) ||
      (name &&
        (byName.get(`${name}|${normalizeKey(c.draft.category ?? "")}`) ??
          (!c.draft.category ? byName.get(`${name}|*`) : undefined))) ||
      undefined;
    if (target) {
      for (const key of fieldKeys) {
        if (isEmptyValue(target.draft[key]) && !isEmptyValue(c.draft[key])) {
          (target.draft as Record<string, unknown>)[key] = c.draft[key];
          if (c.sources[key]) target.sources[key] = c.sources[key];
          if (c.confidence[key]) target.confidence[key] = c.confidence[key];
          if (c.aiClaims?.[key]) target.aiClaims = { ...target.aiClaims, [key]: c.aiClaims[key] };
        }
      }
      for (const img of c.images)
        if (!target.images.some((i) => i.fileId === img.fileId)) target.images.push(img);
      if (c.imageNames?.length) target.imageNames = [...(target.imageNames ?? []), ...c.imageNames];
      index(target);
      continue;
    }
    const copy: Candidate = {
      ...c,
      draft: { ...c.draft },
      sources: { ...c.sources },
      confidence: { ...c.confidence },
      images: [...c.images],
    };
    out.push(copy);
    index(copy);
  }
  return out;

  function index(c: Candidate) {
    if (c.draft.sku) bySku.set(normalizeSku(c.draft.sku), c);
    if (c.draft.name) {
      const n = normalizeKey(c.draft.name);
      byName.set(`${n}|${normalizeKey(c.draft.category ?? "")}`, c);
      byName.set(`${n}|*`, c);
    }
  }
}

export interface MaterialFile {
  id: string;
  /** Relative path inside the folder or ZIP (or just the file name). */
  path: string;
  kind: "image" | "text";
  /** Parsed fields of a text file. */
  textFields?: ProductDraft;
}

export interface FolderMatchResult {
  /** New candidates from per-product folders and text files. */
  candidates: Candidate[];
  /** Images still without a product ("Unassigned"). */
  unassigned: string[];
}

// Matches Italian and English folder names found in client archives.
const GENERIC_FOLDERS = new Set([
  "foto",
  "fotos",
  "immagini",
  "images",
  "image",
  "img",
  "photos",
  "pictures",
  "media",
  "prodotti",
  "products",
  "catalogo",
  "catalog",
]);

/**
 * Pair images and texts by folder name, file name and SKU (page 73). Each leaf folder
 * with a text file, or each folder among several, is one product; loose images match
 * a known product by SKU or name in the file name.
 */
export function matchMaterial(
  files: MaterialFile[],
  known: Candidate[],
  textSource: (f: MaterialFile) => SourceRef,
): FolderMatchResult {
  const candidates: Candidate[] = [];
  const byFolder = new Map<string, MaterialFile[]>();
  const loose: MaterialFile[] = [];
  for (const f of files) {
    const segs = folderSegments(f.path);
    if (segs.length === 0) loose.push(f);
    else {
      const key = segs.join("/");
      byFolder.set(key, [...(byFolder.get(key) ?? []), f]);
    }
  }
  const folders = [...byFolder.entries()];
  const productFolders = folders.filter(([path, list]) => {
    const name = normalizeKey(path.split("/").pop()!);
    const hasText = list.some((f) => f.kind === "text");
    if (hasText) return true;
    if (GENERIC_FOLDERS.has(name)) return false;
    return folders.length > 1;
  });
  for (const [path, list] of folders)
    if (!productFolders.some(([p]) => p === path)) loose.push(...list);

  const skuIndex = buildSkuIndex(known);
  const nameIndex = new Map(
    known.filter((k) => k.draft.name).map((k) => [normalizeKey(k.draft.name!), k]),
  );

  for (const [path, list] of productFolders) {
    const folderName = path.split("/").pop()!;
    const texts = list.filter((f) => f.kind === "text");
    const images = list.filter((f) => f.kind === "image");
    const fromText: Candidate | null = texts.length ? textCandidate(texts, textSource) : null;
    const target =
      skuIndex.get(normalizeSku(folderName)) ??
      (fromText?.draft.sku ? skuIndex.get(normalizeSku(fromText.draft.sku)) : undefined) ??
      nameIndex.get(normalizeKey(folderName)) ??
      (fromText?.draft.name ? nameIndex.get(normalizeKey(fromText.draft.name)) : undefined);
    const refs: ImageRef[] = images.map((img) => ({
      fileId: img.id,
      method: "folder",
      confidence: "high",
    }));
    if (target) {
      target.images.push(...refs);
      if (fromText)
        candidates.push({
          ...fromText,
          draft: {
            ...fromText.draft,
            sku: fromText.draft.sku ?? target.draft.sku,
            name: fromText.draft.name ?? target.draft.name,
          },
        });
      continue;
    }
    const c: Candidate = fromText ?? {
      draft: {},
      sources: {},
      confidence: {},
      images: [],
      origin: { kind: "image", fileName: folderName },
    };
    if (!c.draft.name) {
      c.draft.name = folderName.replace(/[_-]+/g, " ").trim();
      c.sources.name = { kind: "image", fileName: `${path}/` };
      c.confidence.name = "medium";
    }
    c.images.push(...refs);
    candidates.push(c);
  }

  for (const t of loose.filter((f) => f.kind === "text")) {
    const c = textCandidate([t], textSource);
    if (!c.draft.name) {
      c.draft.name = baseName(t.path).replace(/[_-]+/g, " ").trim();
      c.sources.name = textSource(t);
      c.confidence.name = "medium";
    }
    candidates.push(c);
  }

  const all = [...known, ...candidates];
  const allSku = buildSkuIndex(all);
  const allNames = new Map(
    all.filter((k) => k.draft.name).map((k) => [normalizeKey(k.draft.name!), k]),
  );
  const unassigned: string[] = [];
  for (const img of loose.filter((f) => f.kind === "image")) {
    const target = matchImageName(img.path, allSku, allNames, all);
    if (target)
      target.candidate.images.push({
        fileId: img.id,
        method: target.method,
        confidence: target.method === "sku" || target.method === "sheet" ? "high" : "medium",
      });
    else unassigned.push(img.id);
  }
  return { candidates, unassigned };
}

function buildSkuIndex(list: Candidate[]): Map<string, Candidate> {
  const m = new Map<string, Candidate>();
  for (const c of list) {
    if (c.draft.sku) m.set(normalizeSku(c.draft.sku), c);
    for (const v of c.draft.variants ?? []) if (v.sku) m.set(normalizeSku(v.sku), c);
  }
  return m;
}

function textCandidate(
  texts: MaterialFile[],
  textSource: (f: MaterialFile) => SourceRef,
): Candidate {
  const c: Candidate = {
    draft: {},
    sources: {},
    confidence: {},
    images: [],
    origin: textSource(texts[0]!),
  };
  for (const t of texts) {
    for (const key of fieldKeys) {
      const v = t.textFields?.[key];
      if (isEmptyValue(v) || !isEmptyValue(c.draft[key])) continue;
      (c.draft as Record<string, unknown>)[key] = v;
      c.sources[key] = textSource(t);
      c.confidence[key] = "high";
    }
  }
  return c;
}

/**
 * Match an image file name to a product: sheet image column first (exact file name),
 * then a SKU at the start of the name ("RS-CV-050_2.jpg"), then the product name.
 */
export function matchImageName(
  path: string,
  bySku: Map<string, Candidate>,
  byName: Map<string, Candidate>,
  all: Candidate[],
): { candidate: Candidate; method: ImageMatchMethod } | null {
  const file = (path.split("/").pop() ?? path).toLowerCase();
  for (const c of all)
    if (
      c.imageNames?.some(
        (n) =>
          (
            n
              .split(/[\\/?#]/)
              .filter(Boolean)
              .pop() ?? ""
          ).toLowerCase() === file,
      )
    )
      return { candidate: c, method: "sheet" };
  const base = baseName(path);
  const stripped = base.replace(
    /([_\- ]+(\d{1,2}|fronte|retro|front|back|main|det(t?aglio)?|alt))+$/i,
    "",
  );
  const sku = normalizeSku(stripped);
  if (sku.length >= 3) {
    const exact = bySku.get(sku);
    if (exact) return { candidate: exact, method: "sku" };
    // "RSCV050FRONTE" style: longest SKU that prefixes the file name.
    let best: Candidate | null = null;
    let bestLen = 0;
    for (const [k, c] of bySku)
      if (k.length >= 4 && normalizeSku(base).startsWith(k) && k.length > bestLen) {
        best = c;
        bestLen = k.length;
      }
    if (best) return { candidate: best, method: "sku" };
  }
  const name = byName.get(normalizeKey(stripped));
  if (name) return { candidate: name, method: "filename" };
  return null;
}
