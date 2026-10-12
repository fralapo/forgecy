-- Figma Weave (the "weave" image provider) is removed: Jacopo could not connect his
-- subscription (Figma's OAuth kept refusing Forgecy as an unlisted MCP client), so no
-- install ever had a working connection. Any leftover data pointing at it is cleaned up
-- before the ai_provider enum is recreated without the "weave" label.
DELETE FROM "mcp_connections" WHERE "provider" = 'weave';--> statement-breakpoint
DELETE FROM "ai_connections" WHERE "provider" = 'weave';--> statement-breakpoint
UPDATE "jobs_log" SET "provider" = NULL WHERE "provider" = 'weave';--> statement-breakpoint
UPDATE "clients" SET "approved_providers" = array_remove("approved_providers", 'weave'::"public"."ai_provider") WHERE 'weave' = ANY("approved_providers");--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "approved_providers" SET DATA TYPE text[];--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "approved_providers" SET DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "ai_connections" ALTER COLUMN "provider" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "jobs_log" ALTER COLUMN "provider" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "mcp_connections" ALTER COLUMN "provider" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."ai_provider";--> statement-breakpoint
CREATE TYPE "public"."ai_provider" AS ENUM('anthropic', 'openai', 'openrouter', 'google', 'local', 'deepseek', 'higgsfield');--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "approved_providers" SET DEFAULT '{}'::"public"."ai_provider"[];--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "approved_providers" SET DATA TYPE "public"."ai_provider"[] USING "approved_providers"::"public"."ai_provider"[];--> statement-breakpoint
ALTER TABLE "ai_connections" ALTER COLUMN "provider" SET DATA TYPE "public"."ai_provider" USING "provider"::"public"."ai_provider";--> statement-breakpoint
ALTER TABLE "jobs_log" ALTER COLUMN "provider" SET DATA TYPE "public"."ai_provider" USING "provider"::"public"."ai_provider";--> statement-breakpoint
ALTER TABLE "mcp_connections" ALTER COLUMN "provider" SET DATA TYPE "public"."ai_provider" USING "provider"::"public"."ai_provider";
