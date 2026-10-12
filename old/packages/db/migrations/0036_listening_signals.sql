CREATE TYPE "public"."listening_platform" AS ENUM('instagram', 'facebook', 'linkedin', 'tiktok', 'other');--> statement-breakpoint
CREATE TYPE "public"."listening_status" AS ENUM('new', 'recurring', 'used', 'dismissed');--> statement-breakpoint
CREATE TABLE "listening_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"text" text NOT NULL,
	"platform" "listening_platform" DEFAULT 'instagram' NOT NULL,
	"url" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tag" text,
	"status" "listening_status" DEFAULT 'new' NOT NULL,
	"linked_content_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listening_signals" ADD CONSTRAINT "listening_signals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listening_signals" ADD CONSTRAINT "listening_signals_linked_content_id_contents_id_fk" FOREIGN KEY ("linked_content_id") REFERENCES "public"."contents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listening_signals" ADD CONSTRAINT "listening_signals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listening_signals_client_idx" ON "listening_signals" USING btree ("client_id","status","occurred_at");