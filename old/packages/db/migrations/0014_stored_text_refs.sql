ALTER TABLE "audit_channels" ADD COLUMN "unavailable_ref" jsonb;--> statement-breakpoint
ALTER TABLE "audit_competitors" ADD COLUMN "removed_ref" jsonb;--> statement-breakpoint
ALTER TABLE "audit_competitors" ADD COLUMN "source_error_ref" jsonb;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD COLUMN "confidence_ref" jsonb;--> statement-breakpoint
ALTER TABLE "audit_sources" ADD COLUMN "skip_ref" jsonb;--> statement-breakpoint
ALTER TABLE "site_scans" ADD COLUMN "error_ref" jsonb;--> statement-breakpoint
ALTER TABLE "brand_identity_proposals" ADD COLUMN "title_ref" jsonb;--> statement-breakpoint
ALTER TABLE "brand_identity_proposals" ADD COLUMN "rationale_ref" jsonb;--> statement-breakpoint
ALTER TABLE "brand_identity_proposals" ADD COLUMN "stale_ref" jsonb;--> statement-breakpoint
ALTER TABLE "brand_sources" ADD COLUMN "status_detail_ref" jsonb;--> statement-breakpoint
ALTER TABLE "content_slide_edits" ADD COLUMN "note_ref" jsonb;--> statement-breakpoint
ALTER TABLE "product_import_items" ADD COLUMN "match_ref" jsonb;--> statement-breakpoint
ALTER TABLE "product_import_items" ADD COLUMN "discard_ref" jsonb;