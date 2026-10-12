CREATE TYPE "public"."client_import_status" AS ENUM('verifying', 'invalid', 'ready', 'importing', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "client_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"bytes" bigint NOT NULL,
	"status" "client_import_status" DEFAULT 'verifying' NOT NULL,
	"report" jsonb,
	"problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conflicts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolved" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"choices" jsonb,
	"client_id" uuid,
	"result" jsonb,
	"backup_name" text,
	"job_id" uuid,
	"error_ref" jsonb,
	"created_by" uuid,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_imports" ADD CONSTRAINT "client_imports_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_imports" ADD CONSTRAINT "client_imports_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_imports" ADD CONSTRAINT "client_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_imports_created_idx" ON "client_imports" USING btree ("created_at");