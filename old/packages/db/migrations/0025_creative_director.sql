ALTER TYPE "public"."agent_key" ADD VALUE 'creative_director';--> statement-breakpoint
CREATE TABLE "content_creative_directions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" "proposal_status" DEFAULT 'proposed' NOT NULL,
	"direction" jsonb NOT NULL,
	"provenance" jsonb,
	"instruction" text,
	"job_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_creative_directions_decided_by_person" CHECK ("content_creative_directions"."status" not in ('accepted', 'rejected') or ("content_creative_directions"."decided_by" is not null and "content_creative_directions"."decided_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "content_creative_directions" ADD CONSTRAINT "content_creative_directions_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_creative_directions" ADD CONSTRAINT "content_creative_directions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_creative_directions" ADD CONSTRAINT "content_creative_directions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_creative_directions_number_uq" ON "content_creative_directions" USING btree ("content_id","number");