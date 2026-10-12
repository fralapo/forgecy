/** Parts of the Internal Brand System ZIP. No imports: safe in the browser. */

/** Parts a person can choose; `README.md` is always included. */
export const brandSystemParts = [
  "identity",
  "tokens",
  "agent_rules",
  "sources",
  "scores",
  "examples",
  "changelog",
  "assets",
] as const;
export type BrandSystemPart = (typeof brandSystemParts)[number];

/** Files each part adds (directories end with a slash). */
export const brandSystemPartFiles: Record<BrandSystemPart, readonly string[]> = {
  identity: ["brand_identity.json"],
  tokens: ["tokens.json", "tokens.dtcg.json", "tokens.css"],
  agent_rules: ["agent_rules.md"],
  sources: ["sources.json"],
  scores: ["scores.json"],
  examples: ["examples/approved.json", "examples/rejected.json"],
  changelog: ["CHANGELOG.md"],
  assets: ["assets/"],
};

/** Sections of the client-facing Brand Book, in book order (UX spec 15.4). */
export const bookSections = ["strategy", "verbal", "visual", "content", "dos"] as const;
export type BookSection = (typeof bookSections)[number];

/** Key of the agency template in the catalog (templates/reports/brand-book-a4). */
export const BRAND_BOOK_TEMPLATE_KEY = "brand-book-a4";
