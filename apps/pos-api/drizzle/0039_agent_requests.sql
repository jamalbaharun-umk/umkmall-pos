CREATE TABLE "pos"."agent_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"tool" text NOT NULL,
	"request_hash" text NOT NULL,
	"answer" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pos"."agent_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."agent_requests" ADD CONSTRAINT "agent_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_requests_tenant_key_uq" ON "pos"."agent_requests" USING btree ("tenant_id","idempotency_key");