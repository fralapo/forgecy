CREATE TYPE "public"."memory_category" AS ENUM('preference', 'style', 'fact', 'example', 'positioning', 'tone', 'values', 'audience', 'claims', 'palette', 'brand_rules');--> statement-breakpoint
CREATE TYPE "public"."memory_confidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."memory_setting_key" AS ENUM('slide_count', 'format', 'language', 'default_cta');--> statement-breakpoint
CREATE TYPE "public"."memory_status" AS ENUM('observed', 'candidate', 'approved', 'rejected', 'archived');--> statement-breakpoint
CREATE TABLE "client_memory_settings" (
	"client_id" uuid NOT NULL,
	"key" "memory_setting_key" NOT NULL,
	"value" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_memory_settings_client_id_key_pk" PRIMARY KEY("client_id","key")
);
--> statement-breakpoint
CREATE TABLE "memory_item_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"memory_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"category" "memory_category" NOT NULL,
	"author_id" uuid,
	"author_agent" "agent_key",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"agent" "agent_key" NOT NULL,
	"category" "memory_category" NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL,
	"content" text NOT NULL,
	"status" "memory_status" NOT NULL,
	"confidence" "memory_confidence" DEFAULT 'medium' NOT NULL,
	"confidence_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"proposed_by_agent" "agent_key",
	"source_run_id" uuid,
	"source_note" text,
	"created_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_memory_settings" ADD CONSTRAINT "client_memory_settings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_memory_settings" ADD CONSTRAINT "client_memory_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_item_versions" ADD CONSTRAINT "memory_item_versions_memory_id_memory_items_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_item_versions" ADD CONSTRAINT "memory_item_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_source_run_id_jobs_log_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."jobs_log"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_item_versions_uq" ON "memory_item_versions" USING btree ("memory_id","version");--> statement-breakpoint
CREATE INDEX "memory_items_client_status_idx" ON "memory_items" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "memory_items_agent_status_idx" ON "memory_items" USING btree ("agent","status");