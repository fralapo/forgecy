/**
 * Per-client AI confidentiality policy (spec: "Policy di riservatezza AI").
 * The gateway checks it before every request; a job that would break it never starts.
 */
export const aiPolicies = [
  "external_allowed",
  "external_restricted",
  "local_only",
  "no_ai",
] as const;
export type AiPolicy = (typeof aiPolicies)[number];

export const providerIds = ["anthropic", "openai", "openrouter", "google", "local"] as const;
export type ProviderId = (typeof providerIds)[number];

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
