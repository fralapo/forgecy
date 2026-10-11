CREATE TYPE "public"."product_fact_status" AS ENUM('printed_on_pack', 'catalog_only', 'pending_client', 'do_not_use');--> statement-breakpoint
CREATE TABLE "brand_lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"correction" text NOT NULL,
	"rule" text DEFAULT '' NOT NULL,
	"status" "proposal_status" DEFAULT 'proposed' NOT NULL,
	"proposed_by" text NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"text" text NOT NULL,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "product_fact_status" DEFAULT 'catalog_only' NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_pillars" ADD COLUMN "territory" text;--> statement-breakpoint
ALTER TABLE "content_pillars" ADD COLUMN "metric" text;--> statement-breakpoint
ALTER TABLE "content_plans" ADD COLUMN "critical_node" text;--> statement-breakpoint
ALTER TABLE "content_plans" ADD COLUMN "client_needs" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "content_plans" ADD COLUMN "count_rationale" text;--> statement-breakpoint
ALTER TABLE "content_rubrics" ADD COLUMN "cost" text;--> statement-breakpoint
ALTER TABLE "content_rubrics" ADD COLUMN "metric" text;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "published_by" uuid;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "external_url" text;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "stock_credits" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "gates_passed" jsonb;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "delivered_version_id" uuid;--> statement-breakpoint
ALTER TABLE "brand_lessons" ADD CONSTRAINT "brand_lessons_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_lessons" ADD CONSTRAINT "brand_lessons_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_facts" ADD CONSTRAINT "product_facts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_facts" ADD CONSTRAINT "product_facts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_facts" ADD CONSTRAINT "product_facts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_facts" ADD CONSTRAINT "product_facts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_lessons_client_idx" ON "brand_lessons" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "product_facts_product_idx" ON "product_facts" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_facts_client_idx" ON "product_facts" USING btree ("client_id");--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_delivered_version_id_content_versions_id_fk" FOREIGN KEY ("delivered_version_id") REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action;