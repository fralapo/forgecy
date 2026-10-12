ALTER TYPE "public"."asset_source" ADD VALUE 'stock';--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "stock" jsonb;