CREATE TABLE "client_access" (
	"user_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "client_access_user_id_client_id_pk" PRIMARY KEY("user_id","client_id")
);
--> statement-breakpoint
ALTER TABLE "client_access" ADD CONSTRAINT "client_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_access" ADD CONSTRAINT "client_access_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_access" ADD CONSTRAINT "client_access_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_access_client_id_idx" ON "client_access" USING btree ("client_id");--> statement-breakpoint
-- Backfill (ADR 0020): every person who is not an Admin keeps every client they could open
-- before this migration, so an upgrade changes nobody's access. Admins need no rows.
INSERT INTO "client_access" ("user_id", "client_id") SELECT "users"."id", "clients"."id" FROM "users" CROSS JOIN "clients" WHERE NOT "users"."is_admin" ON CONFLICT DO NOTHING;
