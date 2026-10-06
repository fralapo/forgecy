CREATE TYPE "public"."approval_decision" AS ENUM('approved', 'changes_requested');--> statement-breakpoint
CREATE TYPE "public"."asset_source" AS ENUM('upload', 'ai', 'product');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('draft', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."content_objective" AS ENUM('awareness', 'education', 'conversion', 'community');--> statement-breakpoint
CREATE TYPE "public"."content_plan_status" AS ENUM('proposed', 'active', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."content_version_origin" AS ENUM('ai', 'manual', 'restore', 'submit');--> statement-breakpoint
CREATE TYPE "public"."funnel_stage" AS ENUM('awareness', 'consideration', 'conversion', 'loyalty');--> statement-breakpoint
CREATE TYPE "public"."strategy_item_status" AS ENUM('proposed', 'accepted', 'rejected', 'stale', 'archived');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" text DEFAULT 'image' NOT NULL,
	"source" "asset_source" NOT NULL,
	"status" "asset_status" DEFAULT 'draft' NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"alt" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"generation" jsonb,
	"product_id" uuid,
	"content_id" uuid,
	"job_id" uuid,
	"created_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"rejected_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_ai_has_generation" CHECK ("assets"."source" <> 'ai' or "assets"."generation" is not null)
);
--> statement-breakpoint
CREATE TABLE "content_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"decision" "approval_decision" NOT NULL,
	"note" text,
	"self_approval" boolean DEFAULT false NOT NULL,
	"acknowledged" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decided_by" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"version_id" uuid,
	"slide_id" text,
	"body" text NOT NULL,
	"author_id" uuid,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"job_id" uuid,
	"draft" boolean NOT NULL,
	"outputs" text[] DEFAULT '{}'::text[] NOT NULL,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_outlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"outline" jsonb NOT NULL,
	"origin" text NOT NULL,
	"instruction" text,
	"job_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_pillars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"target_id" uuid,
	"name" text NOT NULL,
	"goal" text DEFAULT '' NOT NULL,
	"audience_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"funnel" "funnel_stage",
	"themes" text[] DEFAULT '{}'::text[] NOT NULL,
	"frequency_count" integer,
	"frequency_unit" text,
	"cta" text,
	"emotion" text,
	"examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"forbidden" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "strategy_item_status" DEFAULT 'accepted' NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"product_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"provenance" jsonb,
	"brand_version_id" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"day" integer NOT NULL,
	"channel" text NOT NULL,
	"format" text NOT NULL,
	"pillar_id" uuid,
	"rubric_id" uuid,
	"theme" text NOT NULL,
	"hook" text,
	"notes" text,
	"content_id" uuid,
	"status" "strategy_item_status" DEFAULT 'accepted' NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"product_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"provenance" jsonb,
	"brand_version_id" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_plan_items_day" CHECK ("content_plan_items"."day" between 1 and 30)
);
--> statement-breakpoint
CREATE TABLE "content_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" "content_plan_status" DEFAULT 'proposed' NOT NULL,
	"provenance" jsonb,
	"brand_version_id" uuid,
	"created_by" uuid,
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_rubrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"target_id" uuid,
	"pillar_id" uuid NOT NULL,
	"name" text NOT NULL,
	"frequency_count" integer,
	"frequency_unit" text,
	"structure" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hook_formula" text,
	"hook_example" text,
	"cta" text,
	"template_key" text,
	"channels" text[] DEFAULT '{}'::text[] NOT NULL,
	"owner_id" uuid,
	"status" "strategy_item_status" DEFAULT 'accepted' NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"product_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"provenance" jsonb,
	"brand_version_id" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_slide_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"slide_id" text NOT NULL,
	"instruction" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"note" text,
	"job_id" uuid,
	"model" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"document" jsonb NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_from" "content_version_origin" NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"brand_version_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"type" text DEFAULT 'carousel' NOT NULL,
	"title" text NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"objective" "content_objective" NOT NULL,
	"audience_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"pillar_id" uuid,
	"rubric_id" uuid,
	"plan_item_id" uuid,
	"product_id" uuid,
	"product_revision" integer,
	"channel" text NOT NULL,
	"format" text NOT NULL,
	"template_key" text NOT NULL,
	"template_version" text,
	"slide_count" integer DEFAULT 7 NOT NULL,
	"language" text DEFAULT 'it' NOT NULL,
	"brand_version_id" uuid,
	"brief" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"brief_rev" integer DEFAULT 1 NOT NULL,
	"outline" jsonb,
	"outline_number" integer DEFAULT 0 NOT NULL,
	"outline_brief_rev" integer,
	"outline_approved_by" uuid,
	"outline_approved_at" timestamp with time zone,
	"draft" jsonb,
	"draft_rev" integer DEFAULT 1 NOT NULL,
	"draft_updated_by" uuid,
	"draft_updated_at" timestamp with time zone,
	"current_version_id" uuid,
	"approved_version_id" uuid,
	"reviewer_id" uuid,
	"review_note" text,
	"submitted_by" uuid,
	"locked_by_job_id" uuid,
	"lock_expires_at" timestamp with time zone,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contents_slide_count" CHECK ("contents"."slide_count" between 1 and 20)
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_approvals" ADD CONSTRAINT "content_approvals_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_approvals" ADD CONSTRAINT "content_approvals_version_id_content_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."content_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_approvals" ADD CONSTRAINT "content_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_comments" ADD CONSTRAINT "content_comments_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_comments" ADD CONSTRAINT "content_comments_version_id_content_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_comments" ADD CONSTRAINT "content_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_comments" ADD CONSTRAINT "content_comments_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_exports" ADD CONSTRAINT "content_exports_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_exports" ADD CONSTRAINT "content_exports_version_id_content_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."content_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_exports" ADD CONSTRAINT "content_exports_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_exports" ADD CONSTRAINT "content_exports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_outlines" ADD CONSTRAINT "content_outlines_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_outlines" ADD CONSTRAINT "content_outlines_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_outlines" ADD CONSTRAINT "content_outlines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pillars" ADD CONSTRAINT "content_pillars_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pillars" ADD CONSTRAINT "content_pillars_target_id_content_pillars_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."content_pillars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pillars" ADD CONSTRAINT "content_pillars_brand_version_id_brand_identity_versions_id_fk" FOREIGN KEY ("brand_version_id") REFERENCES "public"."brand_identity_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pillars" ADD CONSTRAINT "content_pillars_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pillars" ADD CONSTRAINT "content_pillars_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pillars" ADD CONSTRAINT "content_pillars_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plan_items" ADD CONSTRAINT "content_plan_items_plan_id_content_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."content_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plan_items" ADD CONSTRAINT "content_plan_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plan_items" ADD CONSTRAINT "content_plan_items_pillar_id_content_pillars_id_fk" FOREIGN KEY ("pillar_id") REFERENCES "public"."content_pillars"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plan_items" ADD CONSTRAINT "content_plan_items_rubric_id_content_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."content_rubrics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plan_items" ADD CONSTRAINT "content_plan_items_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plan_items" ADD CONSTRAINT "content_plan_items_brand_version_id_brand_identity_versions_id_fk" FOREIGN KEY ("brand_version_id") REFERENCES "public"."brand_identity_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plan_items" ADD CONSTRAINT "content_plan_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plan_items" ADD CONSTRAINT "content_plan_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plan_items" ADD CONSTRAINT "content_plan_items_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_brand_version_id_brand_identity_versions_id_fk" FOREIGN KEY ("brand_version_id") REFERENCES "public"."brand_identity_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_rubrics" ADD CONSTRAINT "content_rubrics_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_rubrics" ADD CONSTRAINT "content_rubrics_target_id_content_rubrics_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."content_rubrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_rubrics" ADD CONSTRAINT "content_rubrics_pillar_id_content_pillars_id_fk" FOREIGN KEY ("pillar_id") REFERENCES "public"."content_pillars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_rubrics" ADD CONSTRAINT "content_rubrics_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_rubrics" ADD CONSTRAINT "content_rubrics_brand_version_id_brand_identity_versions_id_fk" FOREIGN KEY ("brand_version_id") REFERENCES "public"."brand_identity_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_rubrics" ADD CONSTRAINT "content_rubrics_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_rubrics" ADD CONSTRAINT "content_rubrics_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_rubrics" ADD CONSTRAINT "content_rubrics_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_slide_edits" ADD CONSTRAINT "content_slide_edits_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_slide_edits" ADD CONSTRAINT "content_slide_edits_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_slide_edits" ADD CONSTRAINT "content_slide_edits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_brand_version_id_brand_identity_versions_id_fk" FOREIGN KEY ("brand_version_id") REFERENCES "public"."brand_identity_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_pillar_id_content_pillars_id_fk" FOREIGN KEY ("pillar_id") REFERENCES "public"."content_pillars"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_rubric_id_content_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."content_rubrics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_plan_item_id_content_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."content_plan_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_brand_version_id_brand_identity_versions_id_fk" FOREIGN KEY ("brand_version_id") REFERENCES "public"."brand_identity_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_outline_approved_by_users_id_fk" FOREIGN KEY ("outline_approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_draft_updated_by_users_id_fk" FOREIGN KEY ("draft_updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_current_version_id_content_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_approved_version_id_content_versions_id_fk" FOREIGN KEY ("approved_version_id") REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_locked_by_job_id_jobs_id_fk" FOREIGN KEY ("locked_by_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_client_sha_uq" ON "assets" USING btree ("client_id","sha256");--> statement-breakpoint
CREATE INDEX "assets_client_status_idx" ON "assets" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "content_approvals_content_idx" ON "content_approvals" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "content_comments_content_idx" ON "content_comments" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "content_exports_content_idx" ON "content_exports" USING btree ("content_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_outlines_number_uq" ON "content_outlines" USING btree ("content_id","number");--> statement-breakpoint
CREATE INDEX "content_pillars_client_idx" ON "content_pillars" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "content_plan_items_plan_idx" ON "content_plan_items" USING btree ("plan_id","day");--> statement-breakpoint
CREATE INDEX "content_plan_items_client_idx" ON "content_plan_items" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_plans_number_uq" ON "content_plans" USING btree ("client_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "content_plans_active_uq" ON "content_plans" USING btree ("client_id") WHERE "content_plans"."status" = 'active';--> statement-breakpoint
CREATE INDEX "content_rubrics_client_idx" ON "content_rubrics" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "content_rubrics_pillar_idx" ON "content_rubrics" USING btree ("pillar_id");--> statement-breakpoint
CREATE INDEX "content_slide_edits_content_idx" ON "content_slide_edits" USING btree ("content_id","slide_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_versions_number_uq" ON "content_versions" USING btree ("content_id","number");--> statement-breakpoint
CREATE INDEX "contents_client_idx" ON "contents" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "contents_plan_item_idx" ON "contents" USING btree ("plan_item_id");--> statement-breakpoint
CREATE INDEX "contents_product_idx" ON "contents" USING btree ("product_id");--> statement-breakpoint
-- Custom SQL: a content version is an immutable snapshot (spec: "Output approvati mai sovrascritti").
CREATE OR REPLACE FUNCTION content_versions_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'content_versions are immutable (version %)', OLD.id USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER content_versions_guard BEFORE UPDATE ON "content_versions"
  FOR EACH ROW EXECUTE FUNCTION content_versions_immutable();
