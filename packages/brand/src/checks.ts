/**
 * "Pronto per la pubblicazione?": open checks on a draft. None of them blocks;
 * each needs an explicit "Ho visto" from the person who publishes.
 */
import { type BrandIdentityDocument, ONE_LINER_MAX_WORDS, toneAxes, wordCount } from "./document";
import type { BlockKey } from "./fields";
import { contrastMatrix, removedTokenPaths, validateTokens, type TokenTree } from "./tokens";

export interface PublishCheck {
  /** Stable key, stored in acknowledged_checks when confirmed. */
  key: string;
  block: BlockKey;
  message: string;
}

export interface PublishCheckContext {
  publishedTokens?: TokenTree | null;
  /** Pending sensitive proposals, by field label. */
  pendingSensitive?: number;
  /** Open conflicts between pending proposals. */
  conflicts?: number;
}

export function publishChecks(
  document: BrandIdentityDocument,
  tokens: TokenTree,
  ctx: PublishCheckContext = {},
): PublishCheck[] {
  const out: PublishCheck[] = [];
  const s = document.strategy;
  const v = document.verbal;

  if (!s.oneLiner) out.push({ key: "incomplete:one-liner", block: "strategy", message: "Manca il one-liner" });
  else if (wordCount(s.oneLiner.value) > ONE_LINER_MAX_WORDS)
    out.push({
      key: "incomplete:one-liner",
      block: "strategy",
      message: `One-liner oltre ${ONE_LINER_MAX_WORDS} parole: il posizionamento non è ancora deciso`,
    });
  if (!s.audience.some((a) => !a.deprecated))
    out.push({ key: "incomplete:audience", block: "strategy", message: "Nessun segmento di pubblico" });
  const unproved = s.messages.filter((m) => m.value.kind === "claim" && !m.value.proof && !m.sourceIds.length);
  if (unproved.length)
    out.push({
      key: "claims:unproved",
      block: "strategy",
      message: `${unproved.length} claim senza prova collegata`,
    });

  const axes = new Set(v.toneAxes.map((a) => a.value.axis));
  if (axes.size < toneAxes.length)
    out.push({
      key: "incomplete:tone-axes",
      block: "verbal",
      message: `Assi del tono definiti: ${axes.size} di ${toneAxes.length}`,
    });
  if (v.weAreWeAreNot.length < 4)
    out.push({
      key: "incomplete:we-are",
      block: "verbal",
      message: `Siamo / Non siamo: ${v.weAreWeAreNot.length} righe, ne servono almeno 4`,
    });

  if (!document.visual.logo.variants.some((l) => l.role === "logo_primary"))
    out.push({ key: "incomplete:logo", block: "visual", message: "Manca il logo principale" });
  const toVerify = document.visual.typography.filter((t) => t.value.licenseStatus === "to_verify");
  if (toVerify.length)
    out.push({
      key: "license:fonts",
      block: "visual",
      message: `Licenza da verificare: ${toVerify.map((t) => t.value.family).join(", ")}`,
    });
  const tokenIssues = validateTokens(tokens);
  if (tokenIssues.length)
    out.push({
      key: "tokens:invalid",
      block: "visual",
      message: `Token non risolti: ${tokenIssues
        .slice(0, 3)
        .map((i) => i.path)
        .join(", ")}${tokenIssues.length > 3 ? "…" : ""}`,
    });
  for (const cell of contrastMatrix(tokens))
    if (cell.grade === "fail")
      out.push({
        key: `contrast:${cell.fg}:${cell.bg}`,
        block: "visual",
        message: `Contrasto non ammesso: ${cell.label} ${cell.ratio?.toFixed(1).replace(".", ",")}:1`,
      });
  if (ctx.publishedTokens) {
    const removed = removedTokenPaths(ctx.publishedTokens, tokens);
    if (removed.length)
      out.push({
        key: "tokens:removed",
        block: "visual",
        message: `Token rimossi o rinominati (i template che li usano useranno il valore di riserva): ${removed.join(", ")}`,
      });
  }
  if (ctx.pendingSensitive)
    out.push({
      key: "proposals:sensitive",
      block: "strategy",
      message: `${ctx.pendingSensitive} proposte sensibili non ancora decise`,
    });
  if (ctx.conflicts)
    out.push({ key: "proposals:conflicts", block: "strategy", message: `${ctx.conflicts} conflitti aperti tra proposte` });
  return out;
}

export interface BlockCompleteness {
  block: BlockKey;
  missing: string[];
}

/** Short "Manca: …" lists for the overview cards. */
export function completeness(document: BrandIdentityDocument, tokens: TokenTree): BlockCompleteness[] {
  const checks = publishChecks(document, tokens);
  const blocks: BlockKey[] = ["strategy", "verbal", "visual", "content"];
  const missing: Record<BlockKey, string[]> = { strategy: [], verbal: [], visual: [], content: [], presence: [] };
  for (const c of checks) missing[c.block].push(c.message);
  if (!document.content.pillars.length) missing.content.push("Nessun pilastro");
  if (!document.channels.length) missing.content.push("Nessuna regola per canale");
  return blocks.map((block) => ({ block, missing: missing[block] }));
}
