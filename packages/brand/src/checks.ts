/**
 * "Ready to publish?": open checks on a draft. None of them blocks;
 * each needs an explicit "I've seen it" from the person who publishes.
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

  if (!s.oneLiner)
    out.push({
      key: "incomplete:one-liner",
      block: "strategy",
      message: "The one-liner is missing",
    });
  else if (wordCount(s.oneLiner.value) > ONE_LINER_MAX_WORDS)
    out.push({
      key: "incomplete:one-liner",
      block: "strategy",
      message: `One-liner over ${ONE_LINER_MAX_WORDS} words: the positioning is not decided yet`,
    });
  if (!s.audience.some((a) => !a.deprecated))
    out.push({
      key: "incomplete:audience",
      block: "strategy",
      message: "No audience segment",
    });
  const unproved = s.messages.filter(
    (m) => m.value.kind === "claim" && !m.value.proof && !m.sourceIds.length,
  );
  if (unproved.length)
    out.push({
      key: "claims:unproved",
      block: "strategy",
      message: `${unproved.length} claims without linked proof`,
    });

  const axes = new Set(v.toneAxes.map((a) => a.value.axis));
  if (axes.size < toneAxes.length)
    out.push({
      key: "incomplete:tone-axes",
      block: "verbal",
      message: `Tone axes defined: ${axes.size} of ${toneAxes.length}`,
    });
  if (v.weAreWeAreNot.length < 4)
    out.push({
      key: "incomplete:we-are",
      block: "verbal",
      message: `We are / We are not: ${v.weAreWeAreNot.length} rows, at least 4 needed`,
    });

  if (!document.visual.logo.variants.some((l) => l.role === "logo_primary"))
    out.push({ key: "incomplete:logo", block: "visual", message: "The primary logo is missing" });
  const toVerify = document.visual.typography.filter((t) => t.value.licenseStatus === "to_verify");
  if (toVerify.length)
    out.push({
      key: "license:fonts",
      block: "visual",
      message: `License to verify: ${toVerify.map((t) => t.value.family).join(", ")}`,
    });
  const tokenIssues = validateTokens(tokens);
  if (tokenIssues.length)
    out.push({
      key: "tokens:invalid",
      block: "visual",
      message: `Unresolved tokens: ${tokenIssues
        .slice(0, 3)
        .map((i) => i.path)
        .join(", ")}${tokenIssues.length > 3 ? "…" : ""}`,
    });
  for (const cell of contrastMatrix(tokens))
    if (cell.grade === "fail")
      out.push({
        key: `contrast:${cell.fg}:${cell.bg}`,
        block: "visual",
        message: `Contrast not allowed: ${cell.label} ${cell.ratio?.toFixed(1)}:1`,
      });
  if (ctx.publishedTokens) {
    const removed = removedTokenPaths(ctx.publishedTokens, tokens);
    if (removed.length)
      out.push({
        key: "tokens:removed",
        block: "visual",
        message: `Tokens removed or renamed (templates that use them will fall back to the default value): ${removed.join(", ")}`,
      });
  }
  if (ctx.pendingSensitive)
    out.push({
      key: "proposals:sensitive",
      block: "strategy",
      message: `${ctx.pendingSensitive} sensitive proposals not decided yet`,
    });
  if (ctx.conflicts)
    out.push({
      key: "proposals:conflicts",
      block: "strategy",
      message: `${ctx.conflicts} open conflicts between proposals`,
    });
  return out;
}

export interface BlockCompleteness {
  block: BlockKey;
  missing: string[];
}

/** Short "Missing: …" lists for the overview cards. */
export function completeness(
  document: BrandIdentityDocument,
  tokens: TokenTree,
): BlockCompleteness[] {
  const checks = publishChecks(document, tokens);
  const blocks: BlockKey[] = ["strategy", "verbal", "visual", "content"];
  const missing: Record<BlockKey, string[]> = {
    strategy: [],
    verbal: [],
    visual: [],
    content: [],
    presence: [],
  };
  for (const c of checks) missing[c.block].push(c.message);
  if (!document.content.pillars.length) missing.content.push("No pillars");
  if (!document.channels.length) missing.content.push("No channel rules");
  return blocks.map((block) => ({ block, missing: missing[block] }));
}
