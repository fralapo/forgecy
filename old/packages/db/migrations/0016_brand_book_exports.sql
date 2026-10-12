CREATE TYPE "public"."brand_book_status" AS ENUM('draft', 'approved', 'exported', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."brand_book_type" AS ENUM('client_book', 'brand_system');--> statement-breakpoint
CREATE TABLE "brand_book_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"type" "brand_book_type" NOT NULL,
	"status" "brand_book_status" NOT NULL,
	"brand_version_id" uuid NOT NULL,
	"brand_version_number" integer NOT NULL,
	"template_key" text,
	"template_version" text,
	"language" text DEFAULT 'en' NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"storage_key" text,
	"file_name" text,
	"bytes" integer,
	"pages" integer,
	"job_id" uuid,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_book_exports" ADD CONSTRAINT "brand_book_exports_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_book_exports" ADD CONSTRAINT "brand_book_exports_brand_version_id_brand_identity_versions_id_fk" FOREIGN KEY ("brand_version_id") REFERENCES "public"."brand_identity_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_book_exports" ADD CONSTRAINT "brand_book_exports_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_book_exports" ADD CONSTRAINT "brand_book_exports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_book_exports" ADD CONSTRAINT "brand_book_exports_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_book_exports_number_uq" ON "brand_book_exports" USING btree ("client_id","number");--> statement-breakpoint
CREATE INDEX "brand_book_exports_client_idx" ON "brand_book_exports" USING btree ("client_id","created_at");