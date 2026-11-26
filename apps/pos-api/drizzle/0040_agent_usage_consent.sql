CREATE TABLE "pos"."agent_access" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"revoked_before" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pos"."agent_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."agent_tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"outcome" text NOT NULL,
	"mode" text,
	"goal_ref" text,
	"assistant_ref" text,
	"run_ref" text,
	"consent_ref" text,
	"actor_id" text NOT NULL,
	"result_refs" jsonb,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pos"."agent_tool_calls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."agent_access" ADD CONSTRAINT "agent_access_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_tool_calls_tenant_at_idx" ON "pos"."agent_tool_calls" USING btree ("tenant_id","created_at");