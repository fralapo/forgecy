CREATE TYPE "public"."brand_check_ignore_reason" AS ENUM('client_request', 'creative_choice', 'false_positive', 'other');--> statement-breakpoint
CREATE TYPE "public"."brand_check_issue_status" AS ENUM('ignored', 'acknowledged');--> statement-breakpoint
CREATE TABLE "brand_check_issue_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"finding_key" text NOT NULL,
	"block_hash" text NOT NULL,
	"status" "brand_check_issue_status" NOT NULL,
	"reason" "brand_check_ignore_reason",
	"note" text,
	"subject_version" integer,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_check_states_uq" UNIQUE NULLS NOT DISTINCT("subject_type","subject_id","finding_key","status","subject_version"),
	CONSTRAINT "brand_check_states_ignore_reason" CHECK ("brand_check_issue_states"."status" <> 'ignored' or "brand_check_issue_states"."reason" is not null),
	CONSTRAINT "brand_check_states_other_note" CHECK ("brand_check_issue_states"."reason" is distinct from 'other' or ("brand_check_issue_states"."note" is not null and length("brand_check_issue_states"."note") between 1 and 280))
);
--> statement-breakpoint
CREATE TABLE "brand_check_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"subject_version" integer,
	"brand_identity_version_id" uuid NOT NULL,
	"has_render" boolean DEFAULT false NOT NULL,
	"report" jsonb NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"warnings" integer DEFAULT 0 NOT NULL,
	"notes" integer DEFAULT 0 NOT NULL,
	"score" integer NOT NULL,
	"run_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_check_runs_score_range" CHECK ("brand_check_runs"."score" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "brand_check_issue_states" ADD CONSTRAINT "brand_check_issue_states_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_check_issue_states" ADD CONSTRAINT "brand_check_issue_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_check_runs" ADD CONSTRAINT "brand_check_runs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_check_runs" ADD CONSTRAINT "brand_check_runs_brand_identity_version_id_brand_identity_versions_id_fk" FOREIGN KEY ("brand_identity_version_id") REFERENCES "public"."brand_identity_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_check_states_subject_idx" ON "brand_check_issue_states" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "brand_check_states_user_idx" ON "brand_check_issue_states" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "brand_check_runs_subject_idx" ON "brand_check_runs" USING btree ("subject_type","subject_id","created_at");--> statement-breakpoint
CREATE INDEX "brand_check_runs_client_idx" ON "brand_check_runs" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "brand_check_runs_brand_version_idx" ON "brand_check_runs" USING btree ("brand_identity_version_id");