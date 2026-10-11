ALTER TABLE "content_plan_items" ADD COLUMN "converted_from_video" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "content_plan_items" ADD COLUMN "conversion_note" text;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "client_version" jsonb;