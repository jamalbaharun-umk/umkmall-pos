CREATE TABLE "pos"."guide_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"guide_key" text NOT NULL,
	"status" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guide_progress_status_ck" CHECK ("pos"."guide_progress"."status" in ('done', 'skipped')),
	CONSTRAINT "guide_progress_key_ck" CHECK ("pos"."guide_progress"."guide_key" ~ '^[a-z0-9_.-]{1,60}$')
);
--> statement-breakpoint
ALTER TABLE "pos"."guide_progress" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."guide_progress" ADD CONSTRAINT "guide_progress_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guide_progress_actor_guide_uq" ON "pos"."guide_progress" USING btree ("tenant_id","actor_kind","actor_id","guide_key");