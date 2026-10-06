CREATE TYPE "public"."confidence_level" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."image_match_method" AS ENUM('folder', 'filename', 'sku', 'sheet', 'ai', 'manual');--> statement-breakpoint
CREATE TYPE "public"."import_file_kind" AS ENUM('sheet', 'pdf', 'image', 'text', 'archive', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."import_file_route" AS ENUM('map', 'match', 'extract', 'source', 'ignore');--> statement-breakpoint
CREATE TYPE "public"."import_image_state" AS ENUM('unassigned', 'assigned', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."import_item_status" AS ENUM('pending', 'accepted', 'approved', 'merged', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."product_image_status" AS ENUM('draft', 'approved');--> statement-breakpoint
CREATE TYPE "public"."product_import_status" AS ENUM('uploading', 'analyzing', 'needs_mapping', 'ready_for_review', 'completed', 'partial', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'proposed', 'approved', 'rejected', 'archived');--> statement-breakpoint
CREATE TABLE "product_column_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"signature" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_field_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"field" text NOT NULL,
	"current_value" jsonb,
	"proposed_value" jsonb NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "proposal_status" DEFAULT 'proposed' NOT NULL,
	"import_id" uuid,
	"proposed_by" text NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"mime" text NOT NULL,
	"file_name" text NOT NULL,
	"alt" text,
	"status" "product_image_status" DEFAULT 'draft' NOT NULL,
	"match_method" "image_match_method" NOT NULL,
	"confidence" "confidence_level" DEFAULT 'high' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"source_import_id" uuid,
	"approved_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_import_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"kind" "import_file_kind" NOT NULL,
	"format" text,
	"route" "import_file_route" NOT NULL,
	"storage_key" text,
	"sha256" text,
	"size" integer DEFAULT 0 NOT NULL,
	"mime" text,
	"valid" boolean DEFAULT true NOT NULL,
	"error_code" text,
	"message" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mapping" jsonb,
	"mapping_proposal" jsonb,
	"mapping_confirmed_by" uuid,
	"mapping_confirmed_at" timestamp with time zone,
	"image_state" "import_image_state",
	"suggestion" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_import_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"status" "import_item_status" DEFAULT 'pending' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"draft" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"field_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" "confidence_level" DEFAULT 'medium' NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL,
	"origin" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposed_by_agent" boolean DEFAULT false NOT NULL,
	"match_product_id" uuid,
	"match_reason" text,
	"match_revision" integer,
	"conflicts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conflict_decisions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolution" text,
	"product_id" uuid,
	"discard_reason" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"status" "product_import_status" DEFAULT 'uploading' NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"job_id" uuid,
	"error_code" text,
	"error" text,
	"failed_step" text,
	"created_by" uuid,
	"started_at" timestamp with time zone,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"category" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"field_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"origin" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_import_id" uuid,
	"proposed_by_agent" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"rejected_reason" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_column_mappings" ADD CONSTRAINT "product_column_mappings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_column_mappings" ADD CONSTRAINT "product_column_mappings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_field_proposals" ADD CONSTRAINT "product_field_proposals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_field_proposals" ADD CONSTRAINT "product_field_proposals_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_field_proposals" ADD CONSTRAINT "product_field_proposals_import_id_product_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."product_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_field_proposals" ADD CONSTRAINT "product_field_proposals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_source_import_id_product_imports_id_fk" FOREIGN KEY ("source_import_id") REFERENCES "public"."product_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_import_files" ADD CONSTRAINT "product_import_files_import_id_product_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."product_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_import_files" ADD CONSTRAINT "product_import_files_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_import_files" ADD CONSTRAINT "product_import_files_parent_id_product_import_files_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."product_import_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_import_files" ADD CONSTRAINT "product_import_files_mapping_confirmed_by_users_id_fk" FOREIGN KEY ("mapping_confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_import_items" ADD CONSTRAINT "product_import_items_import_id_product_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."product_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_import_items" ADD CONSTRAINT "product_import_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_import_items" ADD CONSTRAINT "product_import_items_match_product_id_products_id_fk" FOREIGN KEY ("match_product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_import_items" ADD CONSTRAINT "product_import_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_import_items" ADD CONSTRAINT "product_import_items_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_imports" ADD CONSTRAINT "product_imports_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_imports" ADD CONSTRAINT "product_imports_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_imports" ADD CONSTRAINT "product_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_imports" ADD CONSTRAINT "product_imports_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_source_import_id_product_imports_id_fk" FOREIGN KEY ("source_import_id") REFERENCES "public"."product_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_column_mappings_name_uq" ON "product_column_mappings" USING btree ("client_id","name");--> statement-breakpoint
CREATE INDEX "product_column_mappings_sig_idx" ON "product_column_mappings" USING btree ("client_id","signature");--> statement-breakpoint
CREATE INDEX "product_field_proposals_product_idx" ON "product_field_proposals" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "product_field_proposals_client_idx" ON "product_field_proposals" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "product_images_product_idx" ON "product_images" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_images_product_sha_uq" ON "product_images" USING btree ("product_id","sha256");--> statement-breakpoint
CREATE INDEX "product_import_files_import_idx" ON "product_import_files" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "product_import_files_parent_idx" ON "product_import_files" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "product_import_items_import_idx" ON "product_import_items" USING btree ("import_id","status");--> statement-breakpoint
CREATE INDEX "product_import_items_match_idx" ON "product_import_items" USING btree ("match_product_id");--> statement-breakpoint
CREATE INDEX "product_imports_client_idx" ON "product_imports" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "products_client_status_idx" ON "products" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "products_client_sku_idx" ON "products" USING btree ("client_id","sku");--> statement-breakpoint
CREATE INDEX "products_import_idx" ON "products" USING btree ("source_import_id");