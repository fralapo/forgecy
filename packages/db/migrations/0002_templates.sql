CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"version" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"channel" text,
	"format" text NOT NULL,
	"origin" text DEFAULT 'agency' NOT NULL,
	"client_id" uuid,
	"status" "version_status" DEFAULT 'draft' NOT NULL,
	"manifest" jsonb NOT NULL,
	"package_key" text NOT NULL,
	"package_sha256" text NOT NULL,
	"package_size" integer NOT NULL,
	"validation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version_notes" text,
	"created_by" uuid,
	"submitted_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "templates_origin_check" CHECK ("templates"."origin" in ('agency', 'system'))
);
--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "templates_key_version_idx" ON "templates" USING btree ("key","version");--> statement-breakpoint
CREATE INDEX "templates_status_idx" ON "templates" USING btree ("status");