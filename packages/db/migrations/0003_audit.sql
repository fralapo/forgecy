CREATE TYPE "public"."audit_channel" AS ENUM('website', 'instagram', 'facebook', 'linkedin', 'tiktok');--> statement-breakpoint
CREATE TYPE "public"."audit_status" AS ENUM('draft', 'collecting', 'awaiting_competitors', 'analyzing', 'in_review', 'reviewed', 'delivered', 'failed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."audit_competitor_status" AS ENUM('proposed', 'confirmed', 'removed');--> statement-breakpoint
CREATE TYPE "public"."audit_finding_area" AS ENUM('message', 'visual', 'ux', 'seo_accessibility', 'social_visual', 'social_tone', 'social_cta', 'social_formats', 'linkedin_leads', 'competitors', 'cross_channel');--> statement-breakpoint
CREATE TYPE "public"."audit_finding_kind" AS ENUM('observation', 'problem', 'comparison');--> statement-breakpoint
CREATE TYPE "public"."audit_finding_status" AS ENUM('observed', 'accepted', 'edited', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."audit_level" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."audit_metric_source" AS ENUM('provided_by_prospect', 'agency_tool', 'public_profile', 'file_import', 'other');--> statement-breakpoint
CREATE TYPE "public"."audit_report_status" AS ENUM('draft', 'in_review', 'approved', 'exported', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."audit_report_variant" AS ENUM('full', 'compact');--> statement-breakpoint
CREATE TYPE "public"."audit_source_status" AS ENUM('pending', 'collecting', 'collected', 'partial', 'unavailable', 'skipped', 'failed');--> statement-breakpoint
CREATE TABLE "audit_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"channel" "audit_channel" NOT NULL,
	"profile_url" text,
	"status" "audit_source_status" DEFAULT 'pending' NOT NULL,
	"unavailable_reason" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_competitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"name" text NOT NULL,
	"website_url" text,
	"reason" text,
	"confidence" "audit_level" DEFAULT 'low' NOT NULL,
	"proposed_by_agent" text,
	"status" "audit_competitor_status" DEFAULT 'proposed' NOT NULL,
	"removed_reason" text,
	"source_status" "audit_source_status" DEFAULT 'pending' NOT NULL,
	"source_error" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"kind" "audit_finding_kind" NOT NULL,
	"area" "audit_finding_area" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"impact" text,
	"recommendation" text,
	"priority" "audit_level" DEFAULT 'medium' NOT NULL,
	"suggested_priority" "audit_level",
	"confidence" "audit_level" DEFAULT 'low' NOT NULL,
	"confidence_reason" text,
	"status" "audit_finding_status" DEFAULT 'observed' NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parent_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"comparison" jsonb,
	"competitor_id" uuid,
	"scan_id" uuid,
	"channel" "audit_channel",
	"author_agent" text,
	"ai_meta" jsonb,
	"created_by" uuid,
	"updated_by" uuid,
	"edited_by_human" boolean DEFAULT false NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"rejected_reason" text,
	"position" integer DEFAULT 0 NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"channel" "audit_channel" NOT NULL,
	"metric" text NOT NULL,
	"value" double precision NOT NULL,
	"observed_on" date NOT NULL,
	"source" "audit_metric_source" NOT NULL,
	"source_note" text,
	"source_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"pillars" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "audit_finding_status" DEFAULT 'observed' NOT NULL,
	"author_agent" text,
	"ai_meta" jsonb,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_report_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"variant" "audit_report_variant" NOT NULL,
	"final" boolean NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"bytes" integer NOT NULL,
	"pages" integer NOT NULL,
	"job_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "audit_report_status" DEFAULT 'draft' NOT NULL,
	"template_id" uuid,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excluded_finding_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"email_subject" text,
	"email_body" text,
	"email_by_agent" boolean DEFAULT false NOT NULL,
	"ai_meta" jsonb,
	"findings_at" timestamp with time zone,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"reviewer_id" uuid,
	"submit_note" text,
	"changes_requested" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"exported_at" timestamp with time zone,
	"rev" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_social_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"channel" "audit_channel" NOT NULL,
	"source_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"posted_on" date NOT NULL,
	"post_type" text,
	"format" text,
	"text" text,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"scan_id" uuid,
	"competitor_id" uuid,
	"channel" "audit_channel" NOT NULL,
	"kind" text NOT NULL,
	"method" text NOT NULL,
	"provided_by" text NOT NULL,
	"status" "audit_source_status" DEFAULT 'collected' NOT NULL,
	"url" text,
	"title" text,
	"storage_key" text,
	"storage_key_mobile" text,
	"file_name" text,
	"mime" text,
	"size" integer,
	"sha256" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"skip_reason" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"status" "audit_status" DEFAULT 'draft' NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"owner_id" uuid,
	"created_by" uuid,
	"started_at" timestamp with time zone,
	"competitors_confirmed_by" uuid,
	"competitors_confirmed_at" timestamp with time zone,
	"competitors_skipped" boolean DEFAULT false NOT NULL,
	"diagnosis_at" timestamp with time zone,
	"findings_changed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_profiles" (
	"client_id" uuid PRIMARY KEY NOT NULL,
	"area" text,
	"objectives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"other_objective" text,
	"report_language" text DEFAULT 'it' NOT NULL,
	"owner_id" uuid,
	"social_urls" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"audit_id" uuid,
	"competitor_id" uuid,
	"root_url" text NOT NULL,
	"status" "audit_source_status" DEFAULT 'pending' NOT NULL,
	"max_pages" integer NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"robots" jsonb,
	"extracted" jsonb,
	"error_code" text,
	"error" text,
	"job_id" uuid,
	"created_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_channels" ADD CONSTRAINT "audit_channels_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_channels" ADD CONSTRAINT "audit_channels_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_competitors" ADD CONSTRAINT "audit_competitors_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_competitors" ADD CONSTRAINT "audit_competitors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_competitors" ADD CONSTRAINT "audit_competitors_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_competitor_id_audit_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."audit_competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_scan_id_site_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."site_scans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_metrics" ADD CONSTRAINT "audit_metrics_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_metrics" ADD CONSTRAINT "audit_metrics_source_id_audit_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."audit_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_metrics" ADD CONSTRAINT "audit_metrics_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_plans" ADD CONSTRAINT "audit_plans_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_plans" ADD CONSTRAINT "audit_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_plans" ADD CONSTRAINT "audit_plans_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_report_exports" ADD CONSTRAINT "audit_report_exports_report_id_audit_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."audit_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_report_exports" ADD CONSTRAINT "audit_report_exports_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_report_exports" ADD CONSTRAINT "audit_report_exports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_reports" ADD CONSTRAINT "audit_reports_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_reports" ADD CONSTRAINT "audit_reports_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_reports" ADD CONSTRAINT "audit_reports_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_reports" ADD CONSTRAINT "audit_reports_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_reports" ADD CONSTRAINT "audit_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_reports" ADD CONSTRAINT "audit_reports_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_social_posts" ADD CONSTRAINT "audit_social_posts_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_social_posts" ADD CONSTRAINT "audit_social_posts_source_id_audit_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."audit_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_sources" ADD CONSTRAINT "audit_sources_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_sources" ADD CONSTRAINT "audit_sources_scan_id_site_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."site_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_sources" ADD CONSTRAINT "audit_sources_competitor_id_audit_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."audit_competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_sources" ADD CONSTRAINT "audit_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_competitors_confirmed_by_users_id_fk" FOREIGN KEY ("competitors_confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_profiles" ADD CONSTRAINT "prospect_profiles_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_profiles" ADD CONSTRAINT "prospect_profiles_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_profiles" ADD CONSTRAINT "prospect_profiles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_scans" ADD CONSTRAINT "site_scans_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_scans" ADD CONSTRAINT "site_scans_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_scans" ADD CONSTRAINT "site_scans_competitor_id_audit_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."audit_competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_scans" ADD CONSTRAINT "site_scans_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_scans" ADD CONSTRAINT "site_scans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_channels_uq" ON "audit_channels" USING btree ("audit_id","channel");--> statement-breakpoint
CREATE INDEX "audit_competitors_audit_idx" ON "audit_competitors" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "audit_findings_audit_idx" ON "audit_findings" USING btree ("audit_id","kind","status");--> statement-breakpoint
CREATE INDEX "audit_findings_competitor_idx" ON "audit_findings" USING btree ("competitor_id");--> statement-breakpoint
CREATE INDEX "audit_metrics_audit_idx" ON "audit_metrics" USING btree ("audit_id","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_plans_audit_uq" ON "audit_plans" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "audit_report_exports_report_idx" ON "audit_report_exports" USING btree ("report_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_reports_version_uq" ON "audit_reports" USING btree ("audit_id","version");--> statement-breakpoint
CREATE INDEX "audit_social_posts_audit_idx" ON "audit_social_posts" USING btree ("audit_id","channel","posted_on");--> statement-breakpoint
CREATE INDEX "audit_sources_audit_idx" ON "audit_sources" USING btree ("audit_id","channel");--> statement-breakpoint
CREATE INDEX "audit_sources_scan_idx" ON "audit_sources" USING btree ("scan_id");--> statement-breakpoint
CREATE INDEX "audits_client_idx" ON "audits" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "audits_status_idx" ON "audits" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "audits_one_active_uq" ON "audits" USING btree ("client_id") WHERE "audits"."status" not in ('delivered', 'archived');--> statement-breakpoint
CREATE INDEX "site_scans_audit_idx" ON "site_scans" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "site_scans_client_idx" ON "site_scans" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "site_scans_competitor_idx" ON "site_scans" USING btree ("competitor_id");