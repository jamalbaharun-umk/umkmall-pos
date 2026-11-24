CREATE TABLE "pos"."store_cash_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"amount" bigint NOT NULL,
	"ref_id" uuid,
	"note" text,
	"actor_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_cash_entries_ck" CHECK ("pos"."store_cash_entries"."amount" > 0 and "pos"."store_cash_entries"."direction" in ('in', 'out'))
);
--> statement-breakpoint
ALTER TABLE "pos"."store_cash_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."store_cash_entries" ADD CONSTRAINT "store_cash_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_cash_entries_tenant_idx" ON "pos"."store_cash_entries" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "store_cash_entries_ref_uq" ON "pos"."store_cash_entries" USING btree ("tenant_id","kind","ref_id") WHERE "pos"."store_cash_entries"."ref_id" is not null;--> statement-breakpoint
-- Outside-shift instalments recorded between 0020 and this migration enter the store's cash too.
INSERT INTO "pos"."store_cash_entries" ("tenant_id", "direction", "kind", "amount", "ref_id", "actor_id", "actor_kind", "created_at")
SELECT "tenant_id", 'in', 'receivable_payment', "amount", "id", "actor_id", "actor_kind", "created_at"
FROM "pos"."receivable_payments" WHERE "collected_outside_shift";
