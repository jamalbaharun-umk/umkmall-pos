CREATE TABLE "pos"."purchase_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"shift_id" uuid,
	"drawer_cash_before" bigint,
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
	CONSTRAINT "purchase_payments_ck" CHECK ("pos"."purchase_payments"."amount" > 0 and "pos"."purchase_payments"."source" in ('drawer', 'outside')
          and ("pos"."purchase_payments"."source" = 'drawer') = ("pos"."purchase_payments"."shift_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "pos"."purchase_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."purchase_return_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"return_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_cost" bigint NOT NULL,
	CONSTRAINT "purchase_return_lines_ck" CHECK ("pos"."purchase_return_lines"."qty" > 0 and "pos"."purchase_return_lines"."unit_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pos"."purchase_return_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."purchase_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"total" bigint NOT NULL,
	"refund_due" bigint DEFAULT 0 NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_returns_ck" CHECK ("pos"."purchase_returns"."total" > 0 and "pos"."purchase_returns"."refund_due" >= 0 and "pos"."purchase_returns"."refund_due" <= "pos"."purchase_returns"."total")
);
--> statement-breakpoint
ALTER TABLE "pos"."purchase_returns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."stock_movements" DROP CONSTRAINT "stock_movements_reason_ck";--> statement-breakpoint
ALTER TABLE "pos"."purchase_orders" ADD COLUMN "number" integer;--> statement-breakpoint
ALTER TABLE "pos"."purchase_orders" ADD COLUMN "due_date" date;--> statement-breakpoint
-- UMK-1970: number the purchases so far per store in the order they were created ("PB-0001" ...); new ones get
-- max + 1 at creation (src/purchasing/purchasing.service.ts).
UPDATE "pos"."purchase_orders" o SET "number" = w.n
  FROM (SELECT "id", row_number() OVER (PARTITION BY "tenant_id" ORDER BY "created_at", "id") AS n
          FROM "pos"."purchase_orders") w
 WHERE o."id" = w."id";--> statement-breakpoint
ALTER TABLE "pos"."purchase_payments" ADD CONSTRAINT "purchase_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."purchase_payments" ADD CONSTRAINT "purchase_payments_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "pos"."purchase_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."purchase_payments" ADD CONSTRAINT "purchase_payments_tenant_id_shift_id_shifts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","shift_id") REFERENCES "pos"."shifts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_return_id_purchase_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "pos"."purchase_returns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_order_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "pos"."purchase_order_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "pos"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_batch_id_stock_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "pos"."stock_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."purchase_returns" ADD CONSTRAINT "purchase_returns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."purchase_returns" ADD CONSTRAINT "purchase_returns_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "pos"."purchase_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_payments_order_idx" ON "pos"."purchase_payments" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_payments_tenant_key_uq" ON "pos"."purchase_payments" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "purchase_return_lines_return_idx" ON "pos"."purchase_return_lines" USING btree ("tenant_id","return_id");--> statement-breakpoint
CREATE INDEX "purchase_returns_order_idx" ON "pos"."purchase_returns" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_returns_tenant_key_uq" ON "pos"."purchase_returns" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_tenant_number_uq" ON "pos"."purchase_orders" USING btree ("tenant_id","number");--> statement-breakpoint
ALTER TABLE "pos"."stock_movements" ADD CONSTRAINT "stock_movements_reason_ck" CHECK ("pos"."stock_movements"."reason" in ('opening', 'sale', 'sale_void', 'purchase', 'opname', 'purchase_return'));