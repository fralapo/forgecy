/**
 * Fact bank of a product, as the copy checks and the claim critic use it. Pure and
 * browser-safe. Product highlights are implicit `catalog_only` facts; explicit rows carry
 * their own status (printed_on_pack | catalog_only | pending_client | do_not_use).
 */
import { usableFactStatuses } from "@forgecy/core";
import type { ProductFactRef, ProductSummary } from "../products";

const fold = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
const escapeRe = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether the fact appears in the copy: its whole text (any spacing/case) or one of its keywords as a word. */
export function factInCopy(copy: string, fact: Pick<ProductFactRef, "text" | "keywords">): boolean {
  const text = fold(fact.text);
  if (text && fold(copy).includes(text)) return true;
  return fact.keywords.some((k) => {
    const word = k.trim();
    if (!word) return false;
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(word)}($|[^\\p{L}\\p{N}])`, "iu").test(copy);
  });
}

export interface FactBank {
  /** Lines the copy may rely on: highlights and facts that are usable. */
  usable: string[];
  doNotUse: ProductFactRef[];
  pending: ProductFactRef[];
}

export function factBankOf(product: Pick<ProductSummary, "highlights" | "facts"> | null): FactBank {
  if (!product) return { usable: [], doNotUse: [], pending: [] };
  return {
    usable: [
      ...product.highlights,
      ...product.facts.filter((f) => usableFactStatuses.includes(f.status)).map((f) => f.text),
    ],
    doNotUse: product.facts.filter((f) => f.status === "do_not_use"),
    pending: product.facts.filter((f) => f.status === "pending_client"),
  };
}

/** The verified bank as a prompt block for the claim critic; empty when the product has no facts. */
export function factBankPrompt(bank: FactBank): string {
  if (!bank.usable.length && !bank.doNotUse.length) return "";
  return [
    "## Verified fact bank",
    bank.usable.length
      ? `Claims the copy may make (verified):\n${bank.usable.map((f) => `- ${f}`).join("\n")}`
      : "No verified facts: flag every product claim.",
    bank.doNotUse.length
      ? `Never to be used (flag them if present):\n${bank.doNotUse.map((f) => `- ${f.text}`).join("\n")}`
      : "",
    "A product claim that is not in the verified bank is unsupported: flag it.",
  ]
    .filter(Boolean)
    .join("\n");
}
