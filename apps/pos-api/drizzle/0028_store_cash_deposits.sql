CREATE TABLE "pos"."store_cash_deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"collector_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"note" text,
	"outstanding_before" bigint NOT NULL,
	"received_by_id" uuid NOT NULL,
	"received_by_kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_cash_deposits_ck" CHECK ("pos"."store_cash_deposits"."amount" > 0 and "pos"."store_cash_deposits"."amount" <= "pos"."store_cash_deposits"."outstanding_before")
);
--> statement-breakpoint
ALTER TABLE "pos"."store_cash_deposits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."store_cash_entries" DROP CONSTRAINT "store_cash_entries_ck";--> statement-breakpoint
ALTER TABLE "pos"."store_cash_deposits" ADD CONSTRAINT "store_cash_deposits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."store_cash_deposits" ADD CONSTRAINT "store_cash_deposits_tenant_id_collector_id_staff_tenant_id_id_fk" FOREIGN KEY ("tenant_id","collector_id") REFERENCES "pos"."staff"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_cash_deposits_collector_idx" ON "pos"."store_cash_deposits" USING btree ("tenant_id","collector_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_cash_deposits_tenant_key_uq" ON "pos"."store_cash_deposits" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "pos"."store_cash_entries" ADD CONSTRAINT "store_cash_entries_ck" CHECK ("pos"."store_cash_entries"."amount" > 0 and "pos"."store_cash_entries"."direction" in ('in', 'out', 'transfer'));