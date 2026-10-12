CREATE TYPE "public"."automation_item_status" AS ENUM('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."automation_item_step" AS ENUM('pending', 'created', 'outline', 'slides');--> statement-breakpoint
CREATE TYPE "public"."automation_run_status" AS ENUM('running', 'paused', 'completed', 'partial', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."automation_source" AS ENUM('briefs', 'plan');--> statement-breakpoint
CREATE TYPE "public"."automation_status" AS ENUM('draft', 'active', 'paused', 'failed');--> statement-breakpoint
CREATE TYPE "public"."automation_stop_point" AS ENUM('outline', 'slides');--> statement-breakpoint
CREATE TABLE "automation_run_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"automation_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"item_key" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"input" jsonb NOT NULL,
	"status" "automation_item_status" DEFAULT 'queued' NOT NULL,
	"step" "automation_item_step" DEFAULT 'pending' NOT NULL,
	"content_id" uuid,
	"job_id" uuid,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"error_code" text,
	"error" text,
	"error_ref" jsonb,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" "automation_run_status" DEFAULT 'running' NOT NULL,
	"stop_at" "automation_stop_point" NOT NULL,
	"estimate_micro_usd" bigint DEFAULT 0 NOT NULL,
	"started_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source" "automation_source" NOT NULL,
	"status" "automation_status" DEFAULT 'draft' NOT NULL,
	"status_reason" jsonb,
	"stop_at" "automation_stop_point" DEFAULT 'outline' NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"draft_rev" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_run_items" ADD CONSTRAINT "automation_run_items_run_id_automation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."automation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run_items" ADD CONSTRAINT "automation_run_items_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run_items" ADD CONSTRAINT "automation_run_items_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run_items" ADD CONSTRAINT "automation_run_items_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_run_items_position_uq" ON "automation_run_items" USING btree ("run_id","position");--> statement-breakpoint
CREATE INDEX "automation_run_items_content_idx" ON "automation_run_items" USING btree ("content_id");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_number_uq" ON "automation_runs" USING btree ("automation_id","number");--> statement-breakpoint
CREATE INDEX "automation_runs_client_idx" ON "automation_runs" USING btree ("client_id","started_at");--> statement-breakpoint
CREATE INDEX "automations_client_idx" ON "automations" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "automations_updated_idx" ON "automations" USING btree ("updated_at");