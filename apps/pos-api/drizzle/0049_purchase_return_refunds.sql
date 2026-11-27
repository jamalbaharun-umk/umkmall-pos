CREATE TABLE "pos"."purchase_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"destination" text NOT NULL,
	"note" text,
	"shift_id" uuid,
	"actor_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by_id" uuid,
	"voided_by_kind" text,
	"void_reason" text,
	"drawer_reversed" boolean,
	CONSTRAINT "purchase_refunds_ck" CHECK ("pos"."purchase_refunds"."amount" > 0 and "pos"."purchase_refunds"."destination" in ('drawer', 'store_cash')
          and ("pos"."purchase_refunds"."destination" = 'drawer') = ("pos"."purchase_refunds"."shift_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "pos"."purchase_refunds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."purchase_return_reversals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"return_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_return_reversals_ck" CHECK (length("pos"."purchase_return_reversals"."reason") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "pos"."purchase_return_reversals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."stock_movements" DROP CONSTRAINT "stock_movements_reason_ck";--> statement-breakpoint
ALTER TABLE "pos"."purchase_returns" DROP CONSTRAINT "purchase_returns_ck";--> statement-breakpoint
ALTER TABLE "pos"."purchase_refunds" ADD CONSTRAINT "purchase_refunds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."purchase_refunds" ADD CONSTRAINT "purchase_refunds_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "pos"."purchase_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."purchase_refunds" ADD CONSTRAINT "purchase_refunds_tenant_id_shift_id_shifts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","shift_id") REFERENCES "pos"."shifts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."purchase_return_reversals" ADD CONSTRAINT "purchase_return_reversals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."purchase_return_reversals" ADD CONSTRAINT "purchase_return_reversals_return_id_purchase_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "pos"."purchase_returns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_refunds_order_idx" ON "pos"."purchase_refunds" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_refunds_tenant_key_uq" ON "pos"."purchase_refunds" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_return_reversals_return_uq" ON "pos"."purchase_return_reversals" USING btree ("tenant_id","return_id");--> statement-breakpoint
ALTER TABLE "pos"."purchase_returns" DROP COLUMN "refund_due";--> statement-breakpoint
ALTER TABLE "pos"."stock_movements" ADD CONSTRAINT "stock_movements_reason_ck" CHECK ("pos"."stock_movements"."reason" in ('opening', 'sale', 'sale_void', 'purchase', 'opname', 'purchase_return', 'purchase_return_reversal'));--> statement-breakpoint
ALTER TABLE "pos"."purchase_returns" ADD CONSTRAINT "purchase_returns_ck" CHECK ("pos"."purchase_returns"."total" > 0);