import { fieldDefs, isEmptyValue, type FieldKey, type ProductDraft } from "./fields";

/**
 * Sensitive claims (spec page 72): health, environmental, certifications, warranties.
 * Recognized from a keyword list and, when AI is allowed, flagged by the Brand Analyst;
 * a person always confirms. Price is never sensitive.
 */
export const claimKinds = ["health", "environmental", "certification", "warranty"] as const;
export type ClaimKind = (typeof claimKinds)[number];

export const claimLabels: Record<ClaimKind, string> = {
  health: "Claim di salute",
  environmental: "Claim ambientale",
  certification: "Certificazione",
  warranty: "Garanzia",
};

const KEYWORDS: Record<ClaimKind, RegExp> = {
  health:
    /\b(cura|curativ\w*|guarisc\w*|terapeutic\w*|dermatologicamente|clinicamente|testat[oaie] clinicamente|ipoallergenic\w*|anti[- ]?(age|aging|batteric\w*|infiammator\w*|cellulite|rughe)|antibatteric\w*|previene|prevenzione|benefic\w* per la salute|medical\w*|medico|immunit\w*|detox|dimagr\w*|brucia ?grassi|senza glutine|gluten[- ]free|vegan\w*|biologic\w*|bio\b|naturale al 100|100% natural\w*|hypoallergenic|clinically|dermatologically|cures?|heals?|prevents?|antibacterial|organic)\b/i,
  environmental:
    /\b(eco[- ]?friendly|ecologic\w*|ecosostenibil\w*|sostenibil\w*|biodegradabil\w*|compostabil\w*|riciclabil\w*|riciclat\w*|carbon[- ]?neutral|a impatto zero|impatto zero|zero emissioni|plastic[- ]?free|senza plastica|green|rispettos\w* dell'ambiente|sustainable|recyclable|recycled|compostable)\b/i,
  certification:
    /\b(certificat\w*|certified|iso ?\d{3,5}|ce\b|dop\b|igp\b|doc\b|docg\b|fsc|pefc|ecolabel|ecocert|cosmos|icea|ccpb|fairtrade|nickel tested|nichel tested|halal|kosher|marchio ce)\b/i,
  warranty:
    /\b(garanzi\w*|garantit\w*|warrant\w*|guarantee\w*|soddisfatti o rimborsati|rimborso|a vita)\b/i,
};

/** Claim kinds found in a free text. */
export function detectClaims(text: string): ClaimKind[] {
  if (!text) return [];
  return claimKinds.filter((k) => KEYWORDS[k].test(text));
}

const claimableKeys = new Set(fieldDefs.filter((f) => f.claimable).map((f) => f.key));

/** Fields of the draft carrying claims, with the kinds found. */
export function sensitiveFields(draft: ProductDraft): Partial<Record<FieldKey, ClaimKind[]>> {
  const out: Partial<Record<FieldKey, ClaimKind[]>> = {};
  for (const key of claimableKeys) {
    const v = draft[key];
    if (isEmptyValue(v)) continue;
    const text = Array.isArray(v) ? v.join("\n") : String(v);
    const kinds = detectClaims(text);
    if (kinds.length) out[key] = kinds;
  }
  return out;
}
