ALTER TABLE "users" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "error_ref" jsonb;