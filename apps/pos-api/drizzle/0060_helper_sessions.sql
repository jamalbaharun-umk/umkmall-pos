CREATE TABLE "pos"."helper_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text,
	"parked_sid_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_reason" text,
	CONSTRAINT "helper_sessions_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "helper_sessions_end_ck" CHECK (("pos"."helper_sessions"."ended_at" is null) = ("pos"."helper_sessions"."ended_reason" is null) and ("pos"."helper_sessions"."ended_reason" is null or "pos"."helper_sessions"."ended_reason" in ('owner', 'expired'))),
	CONSTRAINT "helper_sessions_name_ck" CHECK ("pos"."helper_sessions"."name" is null or char_length("pos"."helper_sessions"."name") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "pos"."helper_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD COLUMN "helper_session_id" uuid;--> statement-breakpoint
ALTER TABLE "pos"."helper_sessions" ADD CONSTRAINT "helper_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "helper_sessions_one_live_uq" ON "pos"."helper_sessions" USING btree ("tenant_id","owner_id") WHERE "pos"."helper_sessions"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "helper_sessions_parked_sid_idx" ON "pos"."helper_sessions" USING btree ("parked_sid_hash");