CREATE TABLE "siwc_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"plan_sharing" boolean DEFAULT false NOT NULL,
	"encrypted_state" text,
	"oauth_state" text,
	"last_error" text,
	"connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "siwc_connections" ADD CONSTRAINT "siwc_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "siwc_connections_user_uq" ON "siwc_connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "siwc_connections_oauth_state_idx" ON "siwc_connections" USING btree ("oauth_state");