CREATE TYPE "public"."client_export_status" AS ENUM('queued', 'running', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "client_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"client_name" text NOT NULL,
	"areas" text[] NOT NULL,
	"options" jsonb NOT NULL,
	"status" "client_export_status" DEFAULT 'queued' NOT NULL,
	"job_id" uuid,
	"storage_key" text,
	"file_name" text,
	"bytes" bigint,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_ref" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_exports" ADD CONSTRAINT "client_exports_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_exports" ADD CONSTRAINT "client_exports_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_exports" ADD CONSTRAINT "client_exports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_exports_created_idx" ON "client_exports" USING btree ("created_at");