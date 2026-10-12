/**
 * "Ready to publish?": open checks on a draft. None of them blocks;
 * each needs an explicit "I've seen it" from the person who publishes.
 */
import type { MessageRef } from "@forgecy/core";
import { englishMessage, messageRef, type MessageKey, type MessageValues } from "@forgecy/i18n";
import { type BrandIdentityDocument, ONE_LINER_MAX_WORDS, toneAxes, wordCount } from "./document";
import type { BlockKey } from "./fields";
import { contrastMatrix, removedTokenPaths, validateTokens, type TokenTree } from "./tokens";

export interface PublishCheck {
  /** Stable key, stored in acknowledged_checks when confirmed. */
  key: string;
  block: BlockKey;
  /** English text (logs, errors); the interface shows `ref`. */
  message: string;
  ref: MessageRef;
}

type CheckKey = MessageKey & `brand.checks.${string}`;
const text = (key: CheckKey, values?: MessageValues) => ({
  message: englishMessage(key, values),
  ref: messageRef(key, values),
});

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
      ...text("brand.checks.oneLinerMissing"),
    });
  else if (wordCount(s.oneLiner.value) > ONE_LINER_MAX_WORDS)
    out.push({
      key: "incomplete:one-liner",
      block: "strategy",
      ...text("brand.checks.oneLinerTooLong", { max: ONE_LINER_MAX_WORDS }),
    });
  if (!s.audience.some((a) => !a.deprecated))
    out.push({
      key: "incomplete:audience",
      block: "strategy",
      ...text("brand.checks.noAudience"),
    });
  const unproved = s.messages.filter(
    (m) => m.value.kind === "claim" && !m.value.proof && !m.sourceIds.length,
  );
  if (unproved.length)
    out.push({
      key: "claims:unproved",
      block: "strategy",
      ...text("brand.checks.claimsUnproved", { count: unproved.length }),
    });

  const axes = new Set(v.toneAxes.map((a) => a.value.axis));
  if (axes.size < toneAxes.length)
    out.push({
      key: "incomplete:tone-axes",
      block: "verbal",
      ...text("brand.checks.toneAxes", { defined: axes.size, total: toneAxes.length }),
    });
  if (v.weAreWeAreNot.length < 4)
    out.push({
      key: "incomplete:we-are",
      block: "verbal",
      ...text("brand.checks.weAre", { count: v.weAreWeAreNot.length, min: 4 }),
    });

  if (!document.visual.logo.variants.some((l) => l.role === "logo_primary"))
    out.push({ key: "incomplete:logo", block: "visual", ...text("brand.checks.logoMissing") });
  const toVerify = document.visual.typography.filter((t) => t.value.licenseStatus === "to_verify");
  if (toVerify.length)
    out.push({
      key: "license:fonts",
      block: "visual",
      ...text("brand.checks.fontLicense", {
        fonts: toVerify.map((t) => t.value.family).join(", "),
      }),
    });
  const tokenIssues = validateTokens(tokens);
  if (tokenIssues.length)
    out.push({
      key: "tokens:invalid",
      block: "visual",
      ...text("brand.checks.tokensUnresolved", {
        paths: `${tokenIssues
          .slice(0, 3)
          .map((i) => i.path)
          .join(", ")}${tokenIssues.length > 3 ? "…" : ""}`,
      }),
    });
  for (const cell of contrastMatrix(tokens))
    if (cell.grade === "fail")
      out.push({
        key: `contrast:${cell.fg}:${cell.bg}`,
        block: "visual",
        ...text("brand.checks.contrastFail", {
          pair: cell.id,
          ratio: cell.ratio?.toFixed(1) ?? "",
        }),
      });
  if (ctx.publishedTokens) {
    const removed = removedTokenPaths(ctx.publishedTokens, tokens);
    if (removed.length)
      out.push({
        key: "tokens:removed",
        block: "visual",
        ...text("brand.checks.tokensRemoved", { paths: removed.join(", ") }),
      });
  }
  if (ctx.pendingSensitive)
    out.push({
      key: "proposals:sensitive",
      block: "strategy",
      ...text("brand.checks.sensitivePending", { count: ctx.pendingSensitive }),
    });
  if (ctx.conflicts)
    out.push({
      key: "proposals:conflicts",
      block: "strategy",
      ...text("brand.checks.conflicts", { count: ctx.conflicts }),
    });
  return out;
}

export interface BlockCompleteness {
  block: BlockKey;
  /** English texts; `missingRefs` holds the same items as message references. */
  missing: string[];
  missingRefs: MessageRef[];
}

/** Short "Missing: …" lists for the overview cards. */
export function completeness(
  document: BrandIdentityDocument,
  tokens: TokenTree,
): BlockCompleteness[] {
  const checks = publishChecks(document, tokens);
  const blocks: BlockKey[] = ["strategy", "verbal", "visual", "content"];
  const missing: Record<BlockKey, Array<{ message: string; ref: MessageRef }>> = {
    strategy: [],
    verbal: [],
    visual: [],
    content: [],
    presence: [],
  };
  for (const c of checks) missing[c.block].push({ message: c.message, ref: c.ref });
  if (!document.content.pillars.length) missing.content.push(text("brand.checks.noPillars"));
  if (!document.channels.length) missing.content.push(text("brand.checks.noChannelRules"));
  return blocks.map((block) => ({
    block,
    missing: missing[block].map((m) => m.message),
    missingRefs: missing[block].map((m) => m.ref),
  }));
}
