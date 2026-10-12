CREATE TYPE "public"."social_profile_role" AS ENUM('self', 'competitor', 'prospect');--> statement-breakpoint
CREATE TYPE "public"."social_profile_status" AS ENUM('pending', 'ok', 'error', 'blocked', 'paused');--> statement-breakpoint
CREATE TYPE "public"."social_snapshot_source" AS ENUM('graph_api', 'public_web', 'file_import');--> statement-breakpoint
CREATE TABLE "social_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"dst" text NOT NULL,
	"kind" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"post_ids" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"old" text,
	"new" text,
	"post_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"post_id" text NOT NULL,
	"shortcode" text,
	"posted_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"caption" text,
	"likes" integer,
	"comments" integer,
	"views" integer,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tagged_accounts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"collaborators" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"location" text,
	"is_sponsored" boolean DEFAULT false NOT NULL,
	"is_pinned" boolean,
	"carousel_count" integer,
	"accessibility_caption" text,
	"source" "social_snapshot_source" NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"handle" text NOT NULL,
	"role" "social_profile_role" DEFAULT 'competitor' NOT NULL,
	"audit_id" uuid,
	"preferred_source" "social_snapshot_source",
	"monitored" boolean DEFAULT false NOT NULL,
	"interval_hours" integer DEFAULT 24 NOT NULL,
	"status" "social_profile_status" DEFAULT 'pending' NOT NULL,
	"status_reason" jsonb,
	"last_snapshot_at" timestamp with time zone,
	"latest_post_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"source" "social_snapshot_source" NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"profile" jsonb NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"post_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_edges" ADD CONSTRAINT "social_edges_profile_id_social_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."social_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_events" ADD CONSTRAINT "social_events_profile_id_social_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."social_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_profile_id_social_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."social_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD CONSTRAINT "social_profiles_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD CONSTRAINT "social_profiles_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD CONSTRAINT "social_profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_snapshots" ADD CONSTRAINT "social_snapshots_profile_id_social_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."social_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_edges_uq" ON "social_edges" USING btree ("profile_id","dst","kind");--> statement-breakpoint
CREATE INDEX "social_edges_dst_idx" ON "social_edges" USING btree ("dst");--> statement-breakpoint
CREATE INDEX "social_events_profile_idx" ON "social_events" USING btree ("profile_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_posts_profile_post_uq" ON "social_posts" USING btree ("profile_id","post_id");--> statement-breakpoint
CREATE INDEX "social_posts_profile_idx" ON "social_posts" USING btree ("profile_id","posted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_profiles_client_handle_uq" ON "social_profiles" USING btree ("client_id","handle");--> statement-breakpoint
CREATE INDEX "social_profiles_due_idx" ON "social_profiles" USING btree ("monitored","status","next_run_at");--> statement-breakpoint
CREATE INDEX "social_snapshots_profile_idx" ON "social_snapshots" USING btree ("profile_id","observed_at");