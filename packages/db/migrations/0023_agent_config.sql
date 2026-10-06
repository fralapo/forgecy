CREATE TYPE "public"."agent_instruction_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."agent_key" AS ENUM('strategist', 'brand_analyst', 'art_director', 'copywriter', 'reviewer');--> statement-breakpoint
CREATE TABLE "agent_instructions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent" "agent_key" NOT NULL,
	"version" integer NOT NULL,
	"text" text NOT NULL,
	"changelog" text,
	"status" "agent_instruction_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_settings" (
	"agent" "agent_key" PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"routes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_instructions" ADD CONSTRAINT "agent_instructions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_instructions" ADD CONSTRAINT "agent_instructions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_instructions_version_uq" ON "agent_instructions" USING btree ("agent","version");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_instructions_one_draft_uq" ON "agent_instructions" USING btree ("agent") WHERE "agent_instructions"."status" = 'draft';