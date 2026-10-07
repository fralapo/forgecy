import {
  aiPolicies,
  clientStatuses,
  contentStatuses,
  itemStatuses,
  jobStatuses,
  proposalStatuses,
  providerIds,
  sendableAssetTypes,
  versionStatuses,
} from "@forgecy/core";
import { pgEnum } from "drizzle-orm/pg-core";

// Enum values come from @forgecy/core so the database and the Zod schemas never drift.
export const aiPolicyEnum = pgEnum("ai_policy", aiPolicies);
export const clientStatusEnum = pgEnum("client_status", clientStatuses);
export const contentStatusEnum = pgEnum("content_status", contentStatuses);
export const itemStatusEnum = pgEnum("item_status", itemStatuses);
export const jobStatusEnum = pgEnum("job_status", jobStatuses);
export const proposalStatusEnum = pgEnum("proposal_status", proposalStatuses);
export const providerEnum = pgEnum("ai_provider", providerIds);
export const sendableAssetEnum = pgEnum("ai_sendable_asset", sendableAssetTypes);
export const versionStatusEnum = pgEnum("version_status", versionStatuses);
export const scopeEnum = pgEnum("budget_scope", ["agency", "client"]);
export const connectionScopeEnum = pgEnum("connection_scope", ["agency", "client", "user"]);
