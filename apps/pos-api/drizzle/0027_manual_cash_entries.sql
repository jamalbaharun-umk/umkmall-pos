CREATE TABLE "pos"."manual_cash_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"amount" bigint NOT NULL,
	"drawer_cash_before" bigint NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_cash_entries_ck" CHECK ("pos"."manual_cash_entries"."amount" > 0 and "pos"."manual_cash_entries"."direction" in ('in', 'out'))
);
--> statement-breakpoint
ALTER TABLE "pos"."manual_cash_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."manual_cash_entries" ADD CONSTRAINT "manual_cash_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."manual_cash_entries" ADD CONSTRAINT "manual_cash_entries_tenant_id_shift_id_shifts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","shift_id") REFERENCES "pos"."shifts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manual_cash_entries_shift_idx" ON "pos"."manual_cash_entries" USING btree ("tenant_id","shift_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manual_cash_entries_tenant_key_uq" ON "pos"."manual_cash_entries" USING btree ("tenant_id","idempotency_key");