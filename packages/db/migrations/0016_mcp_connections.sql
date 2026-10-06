ALTER TYPE "public"."ai_provider" ADD VALUE 'higgsfield';--> statement-breakpoint
ALTER TYPE "public"."ai_provider" ADD VALUE 'weave';--> statement-breakpoint
CREATE TABLE "mcp_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"server_url" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"encrypted_state" text,
	"oauth_state" text,
	"last_error" text,
	"connected_by" uuid,
	"connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_connections_provider_uq" ON "mcp_connections" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "mcp_connections_oauth_state_idx" ON "mcp_connections" USING btree ("oauth_state");