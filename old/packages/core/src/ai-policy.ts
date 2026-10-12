/**
 * Per-client AI confidentiality policy (spec: "AI confidentiality policy").
 * The gateway checks it before every request; a job that would break it never starts.
 */
export const aiPolicies = [
  "external_allowed",
  "external_restricted",
  "local_only",
  "no_ai",
] as const;
export type AiPolicy = (typeof aiPolicies)[number];

/** app_settings key of the policy new clients start with (set by an Admin; see @forgecy/ai). */
export const DEFAULT_AI_POLICY_KEY = "ai.default_policy";

/** The policy a stored setting stands for: `external_allowed` until an Admin sets a valid one. */
export function resolveDefaultAiPolicy(value: unknown): AiPolicy {
  return aiPolicies.find((p) => p === value) ?? "external_allowed";
}

export const providerIds = [
  "anthropic",
  "openai",
  "openrouter",
  "google",
  "local",
  "deepseek",
  "higgsfield",
] as const;
export type ProviderId = (typeof providerIds)[number];

/**
 * Kinds of client files and texts an external_restricted client may send to its
 * approved providers (page 61). A kind left unchecked never leaves Forgecy: the
 * gateway sends such a request only to a local model.
 */
export const sendableAssetTypes = [
  "brand_assets",
  "client_photos",
  "audit_screenshots",
  "documents",
  "brand_texts",
] as const;
export type SendableAssetType = (typeof sendableAssetTypes)[number];

export function isLocalProvider(provider: ProviderId): boolean {
  return provider === "local";
}

export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: "no_ai" | "external_blocked" | "provider_not_approved" };

export function checkAiPolicy(
  policy: AiPolicy,
  provider: ProviderId,
  approvedProviders: readonly ProviderId[] = [],
): PolicyDecision {
  switch (policy) {
    case "no_ai":
      return { allowed: false, reason: "no_ai" };
    case "local_only":
      return isLocalProvider(provider)
        ? { allowed: true }
        : { allowed: false, reason: "external_blocked" };
    case "external_restricted":
      return isLocalProvider(provider) || approvedProviders.includes(provider)
        ? { allowed: true }
        : { allowed: false, reason: "provider_not_approved" };
    case "external_allowed":
      return { allowed: true };
  }
}

/** Spending limits apply to the whole agency or to one client. */
export const budgetScopes = ["agency", "client"] as const;
/** Who a saved connection belongs to. */
export const connectionScopes = ["agency", "client", "user"] as const;
/** Outcome of one AI call in `jobs_log`. */
export const aiCallStatuses = ["ok", "error", "blocked"] as const;
export const apiKeyStatuses = ["active", "disabled"] as const;
/** Admin's check of a provider's commercial-use terms. */
export const commercialUseStatuses = ["pending_verification", "verified", "rejected"] as const;
/** State of an OAuth connection (MCP providers, Sign in with ChatGPT). */
export const oauthConnectionStatuses = ["pending", "connected", "error"] as const;
