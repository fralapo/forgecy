ALTER TYPE "public"."asset_source" ADD VALUE 'site';--> statement-breakpoint
ALTER TABLE "brand_sources" ADD COLUMN "visual" jsonb;