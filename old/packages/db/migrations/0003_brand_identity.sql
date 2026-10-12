CREATE TYPE "public"."actor_type" AS ENUM('user', 'agent');--> statement-breakpoint
CREATE TYPE "public"."brand_example_kind" AS ENUM('copy', 'caption', 'slide', 'image');--> statement-breakpoint
CREATE TYPE "public"."brand_example_verdict" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."brand_source_kind" AS ENUM('brand_book', 'document', 'interview', 'questionnaire', 'client_approval', 'manual', 'internal_feedback', 'website', 'instagram', 'facebook', 'linkedin', 'tiktok', 'screenshot', 'audit', 'competitor', 'agent_observation');--> statement-breakpoint
CREATE TYPE "public"."brand_source_status" AS ENUM('pending', 'extracting', 'extracted', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."confidence_level" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TABLE "brand_examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" "brand_example_kind" NOT NULL,
	"verdict" "brand_example_verdict" NOT NULL,
	"body" text NOT NULL,
	"reason" text NOT NULL,
	"channel" text,
	"pillar_key" text,
	"format_key" text,
	"content_version_id" uuid,
	"storage_key" text,
	"source_id" uuid,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_identities_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "brand_identity_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"brand_identity_id" uuid NOT NULL,
	"author_type" "actor_type" NOT NULL,
	"author_user_id" uuid,
	"agent_role" text,
	"run_id" uuid,
	"base_version_id" uuid,
	"base_rev" integer,
	"field_path" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"changes" jsonb NOT NULL,
	"rationale" text,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" "confidence_level" NOT NULL,
	"model_confidence" real,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sensitive" boolean NOT NULL,
	"status" "proposal_status" DEFAULT 'proposed' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"edited_value" jsonb,
	"stale_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_proposals_author" CHECK (("brand_identity_proposals"."author_type" = 'agent' and "brand_identity_proposals"."agent_role" is not null) or ("brand_identity_proposals"."author_type" = 'user' and "brand_identity_proposals"."author_user_id" is not null)),
	CONSTRAINT "brand_proposals_reviewed_by_person" CHECK ("brand_identity_proposals"."status" not in ('accepted', 'rejected') or ("brand_identity_proposals"."reviewed_by" is not null and "brand_identity_proposals"."reviewed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "brand_identity_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_identity_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" "version_status" DEFAULT 'draft' NOT NULL,
	"document" jsonb NOT NULL,
	"tokens" jsonb NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"changelog" text,
	"restored_from_version_id" uuid,
	"created_by" uuid,
	"last_edited_by" uuid,
	"editor_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"review_comment" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"acknowledged_checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_versions_approved_by_person" CHECK ("brand_identity_versions"."status" not in ('approved', 'published') or ("brand_identity_versions"."approved_by" is not null and "brand_identity_versions"."approved_at" is not null)),
	CONSTRAINT "brand_versions_published_by_person" CHECK ("brand_identity_versions"."status" <> 'published' or ("brand_identity_versions"."published_by" is not null and "brand_identity_versions"."published_at" is not null)),
	CONSTRAINT "brand_versions_number_positive" CHECK ("brand_identity_versions"."number" > 0)
);
--> statement-breakpoint
CREATE TABLE "brand_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" "brand_source_kind" NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"storage_key" text,
	"mime" text,
	"size" bigint,
	"sha256" text,
	"external_ref" text,
	"status" "brand_source_status" DEFAULT 'pending' NOT NULL,
	"status_detail" text,
	"pages" jsonb,
	"note" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_examples" ADD CONSTRAINT "brand_examples_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_examples" ADD CONSTRAINT "brand_examples_source_id_brand_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."brand_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_examples" ADD CONSTRAINT "brand_examples_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_identities" ADD CONSTRAINT "brand_identities_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_identity_proposals" ADD CONSTRAINT "brand_identity_proposals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_identity_proposals" ADD CONSTRAINT "brand_identity_proposals_brand_identity_id_brand_identities_id_fk" FOREIGN KEY ("brand_identity_id") REFERENCES "public"."brand_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_identity_proposals" ADD CONSTRAINT "brand_identity_proposals_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_identity_proposals" ADD CONSTRAINT "brand_identity_proposals_base_version_id_brand_identity_versions_id_fk" FOREIGN KEY ("base_version_id") REFERENCES "public"."brand_identity_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_identity_proposals" ADD CONSTRAINT "brand_identity_proposals_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_identity_versions" ADD CONSTRAINT "brand_identity_versions_brand_identity_id_brand_identities_id_fk" FOREIGN KEY ("brand_identity_id") REFERENCES "public"."brand_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_identity_versions" ADD CONSTRAINT "brand_identity_versions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_identity_versions" ADD CONSTRAINT "brand_identity_versions_restored_from_version_id_brand_identity_versions_id_fk" FOREIGN KEY ("restored_from_version_id") REFERENCES "public"."brand_identity_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_identity_versions" ADD CONSTRAINT "brand_identity_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_identity_versions" ADD CONSTRAINT "brand_identity_versions_last_edited_by_users_id_fk" FOREIGN KEY ("last_edited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_identity_versions" ADD CONSTRAINT "brand_identity_versions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_identity_versions" ADD CONSTRAINT "brand_identity_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_identity_versions" ADD CONSTRAINT "brand_identity_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_sources" ADD CONSTRAINT "brand_sources_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_sources" ADD CONSTRAINT "brand_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_examples_client_idx" ON "brand_examples" USING btree ("client_id","verdict");--> statement-breakpoint
CREATE INDEX "brand_proposals_client_status_idx" ON "brand_identity_proposals" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "brand_proposals_field_idx" ON "brand_identity_proposals" USING btree ("brand_identity_id","field_path");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_versions_number_uq" ON "brand_identity_versions" USING btree ("brand_identity_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_versions_one_published_uq" ON "brand_identity_versions" USING btree ("client_id") WHERE "brand_identity_versions"."status" = 'published';--> statement-breakpoint
CREATE UNIQUE INDEX "brand_versions_one_open_uq" ON "brand_identity_versions" USING btree ("brand_identity_id") WHERE "brand_identity_versions"."status" in ('draft', 'in_review');--> statement-breakpoint
CREATE INDEX "brand_versions_client_idx" ON "brand_identity_versions" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "brand_sources_client_idx" ON "brand_sources" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_sources_file_uq" ON "brand_sources" USING btree ("client_id","sha256") WHERE "brand_sources"."sha256" is not null and "brand_sources"."removed_at" is null;