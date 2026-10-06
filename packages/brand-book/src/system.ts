/**
 * Internal Brand System (UX spec 15.1): a technical ZIP for the agency and its
 * agents, built from a published Brand Identity version. It holds the identity as
 * JSON, the DTCG tokens, the rules the agents receive, the sources and the
 * confidence of every field. It is never meant for the client: the README says so.
 *
 * Everything here is pure: the service loads the rows and file bytes, this module
 * lays out the files and zips them with fixed timestamps, so the same input always
 * gives the same bytes.
 */
import {
  buildBrandContext,
  fieldLabel,
  tokenColorHex,
  tokensToCssVars,
  type BrandIdentityDocument,
  type ContextExample,
  type TokenTree,
} from "@forgecy/brand";
import { flattenTokens } from "@forgecy/ui/tokens";
import { strToU8, zipSync, type Zippable } from "fflate";
import { brandSystemParts, type BrandSystemPart } from "./parts";

export interface BrandSystemSource {
  id: string;
  kind: string;
  title: string;
  url: string | null;
  mime: string | null;
  size: number | null;
  status: string;
  capturedAt: Date;
}

export interface BrandSystemAsset {
  /** Path inside the ZIP, under `assets/`. */
  path: string;
  sourceId: string;
  bytes: Uint8Array;
}

export interface BrandSystemInput {
  client: { name: string; slug: string };
  version: {
    id: string;
    number: number;
    publishedAt: Date;
    document: BrandIdentityDocument;
    tokens: TokenTree;
  };
  /** Approved versions, newest first; only those up to `version` are listed. */
  history: Array<{ number: number; publishedAt: Date | null; changelog: string | null }>;
  sources: BrandSystemSource[];
  examples: ContextExample[];
  assets: BrandSystemAsset[];
  generatedAt: Date;
}

export interface FieldScore {
  pointer: string;
  label: string;
  confidence: string;
  sourceIds: string[];
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

interface SourcedLike {
  value: unknown;
  confidence: string;
  sourceIds: string[];
  deprecated?: boolean;
}

function isSourced(v: unknown): v is SourcedLike {
  return (
    typeof v === "object" &&
    v !== null &&
    "id" in v &&
    "value" in v &&
    "confidence" in v &&
    Array.isArray((v as { sourceIds?: unknown }).sourceIds)
  );
}

/** Confidence and cited sources of every live Sourced field, with its JSON Pointer. */
export function fieldScores(document: BrandIdentityDocument): FieldScore[] {
  const out: FieldScore[] = [];
  const walk = (node: unknown, pointer: string) => {
    if (isSourced(node)) {
      if (node.deprecated) return;
      out.push({
        pointer,
        label: fieldLabel(pointer),
        confidence: node.confidence,
        sourceIds: node.sourceIds,
      });
      return;
    }
    if (Array.isArray(node)) node.forEach((item, i) => walk(item, `${pointer}/${i}`));
    else if (typeof node === "object" && node !== null)
      for (const [k, v] of Object.entries(node)) walk(v, `${pointer}/${k}`);
  };
  walk(document, "/document");
  return out;
}

/** Resolved tokens by dot path; colors as hex, aliases followed. */
export function flatTokens(tree: TokenTree): Record<string, { type?: string; value: string }> {
  const vars = tokensToCssVars(tree, "t");
  const out: Record<string, { type?: string; value: string }> = {};
  for (const [path, token] of flattenTokens(tree)) {
    const css = vars[`--t-${path.replace(/\./g, "-")}`];
    if (css === undefined) continue;
    const hex = token.type === "color" ? tokenColorHex(tree, path) : null;
    out[path] = { ...(token.type ? { type: token.type } : {}), value: hex ?? css };
  }
  return out;
}

export function tokensCss(tree: TokenTree): string {
  const lines = Object.entries(tokensToCssVars(tree)).map(([k, v]) => `  ${k}: ${v};`);
  return `:root {\n${lines.join("\n")}\n}\n`;
}

function readme(input: BrandSystemInput, files: string[]): string {
  return [
    `# ${input.client.name} · Internal Brand System`,
    "",
    "> Internal: contains agent rules and prompts. Do not share it with the client.",
    "",
    `Brand Identity version ${input.version.number}, published ${input.version.publishedAt.toISOString()}.`,
    `Generated ${input.generatedAt.toISOString()} by Forgecy.`,
    "",
    "## Files",
    "",
    ...files.map((f) => `- \`${f}\``),
    "",
  ].join("\n");
}

function changelog(input: BrandSystemInput): string {
  const lines = [`# ${input.client.name} · Brand Identity changelog`, ""];
  for (const v of input.history.filter((h) => h.number <= input.version.number)) {
    lines.push(`## Version ${v.number}${v.publishedAt ? ` · ${iso(v.publishedAt)}` : ""}`, "");
    lines.push(v.changelog?.trim() || "No changelog.", "");
  }
  return lines.join("\n");
}

/** The ZIP's files, keyed by path, `README.md` first. */
export function buildBrandSystemFiles(
  input: BrandSystemInput,
  parts: readonly BrandSystemPart[],
): Map<string, Uint8Array> {
  const chosen = brandSystemParts.filter((p) => parts.includes(p));
  const files = new Map<string, string | Uint8Array>();
  const { version } = input;
  for (const part of chosen) {
    switch (part) {
      case "identity":
        files.set(
          "brand_identity.json",
          json({
            client: input.client,
            version: {
              id: version.id,
              number: version.number,
              publishedAt: iso(version.publishedAt),
            },
            document: version.document,
          }),
        );
        break;
      case "tokens":
        files.set("tokens.json", json(flatTokens(version.tokens)));
        files.set("tokens.dtcg.json", json(version.tokens));
        files.set("tokens.css", tokensCss(version.tokens));
        break;
      case "agent_rules":
        files.set(
          "agent_rules.md",
          `${buildBrandContext({
            versionId: version.id,
            number: version.number,
            document: version.document,
            tokens: version.tokens,
          }).stable.trim()}\n`,
        );
        break;
      case "sources": {
        const assetOf = new Map(input.assets.map((a) => [a.sourceId, a.path]));
        files.set(
          "sources.json",
          json(
            input.sources.map((s) => ({
              id: s.id,
              kind: s.kind,
              title: s.title,
              url: s.url,
              mime: s.mime,
              size: s.size,
              status: s.status,
              capturedAt: iso(s.capturedAt),
              ...(assetOf.has(s.id) ? { file: assetOf.get(s.id) } : {}),
            })),
          ),
        );
        break;
      }
      case "scores": {
        const scores = fieldScores(version.document);
        const summary: Record<string, number> = {};
        for (const s of scores) summary[s.confidence] = (summary[s.confidence] ?? 0) + 1;
        files.set("scores.json", json({ summary, fields: scores }));
        break;
      }
      case "examples":
        for (const verdict of ["approved", "rejected"] as const)
          files.set(
            `examples/${verdict}.json`,
            json(
              input.examples
                .filter((e) => e.verdict === verdict)
                .map((e) => ({
                  id: e.id,
                  kind: e.kind,
                  body: e.body,
                  reason: e.reason,
                  channel: e.channel,
                  pillarKey: e.pillarKey,
                  formatKey: e.formatKey,
                  createdAt: iso(e.createdAt),
                })),
            ),
          );
        break;
      case "changelog":
        files.set("CHANGELOG.md", changelog(input));
        break;
      case "assets":
        for (const a of input.assets) files.set(a.path, a.bytes);
        break;
    }
  }
  const out = new Map<string, Uint8Array>();
  out.set("README.md", strToU8(readme(input, ["README.md", ...files.keys()])));
  for (const [path, body] of files) out.set(path, typeof body === "string" ? strToU8(body) : body);
  return out;
}

/** Fixed timestamp: the same files always zip to the same bytes. */
const ZIP_MTIME = new Date("2000-01-01T00:00:00Z");

export function zipFiles(files: Map<string, Uint8Array>, root: string): Uint8Array {
  const tree: Zippable = {};
  for (const [path, body] of files) tree[`${root}/${path}`] = [body, { mtime: ZIP_MTIME }];
  return zipSync(tree, { level: 6 });
}

const safe = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "file";

const byMime: Record<string, string> = {
  "image/svg+xml": "svg",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "font/ttf": "ttf",
  "font/otf": "otf",
  "font/woff2": "woff2",
};

const extOf = (title: string, mime: string | null) => {
  const m = /\.([a-z0-9]{1,8})$/i.exec(title);
  if (m?.[1]) return m[1].toLowerCase();
  return (mime && byMime[mime]) ?? "bin";
};

/** Logo and font files the document points to, with the path they get in the ZIP. */
export function assetRefs(
  document: BrandIdentityDocument,
  sources: ReadonlyArray<Pick<BrandSystemSource, "id" | "title" | "mime">>,
): Array<{ sourceId: string; path: string }> {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const out = new Map<string, string>();
  const add = (sourceId: string | undefined, dir: string, name: string) => {
    const s = sourceId ? byId.get(sourceId) : undefined;
    if (!s || out.has(s.id)) return;
    out.set(s.id, `assets/${dir}/${safe(name)}-${s.id.slice(0, 8)}.${extOf(s.title, s.mime)}`);
  };
  for (const v of document.visual.logo.variants) add(v.sourceId, "logos", v.role);
  for (const t of document.visual.typography)
    if (!t.deprecated) add(t.value.sourceId, "fonts", t.value.family);
  return [...out].map(([sourceId, path]) => ({ sourceId, path }));
}

export function brandSystemFileName(slug: string, versionNumber: number, bookNumber: number) {
  return `${safe(slug)}-brand-system-v${versionNumber}-bb${bookNumber}.zip`;
}
