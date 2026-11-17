CREATE TABLE "pos"."stock_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty_initial" integer NOT NULL,
	"qty_remaining" integer NOT NULL,
	"unit_cost" bigint NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"source_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_batches_qty_ck" CHECK ("pos"."stock_batches"."qty_initial" > 0 and "pos"."stock_batches"."qty_remaining" >= 0 and "pos"."stock_batches"."qty_remaining" <= "pos"."stock_batches"."qty_initial"),
	CONSTRAINT "stock_batches_cost_ck" CHECK ("pos"."stock_batches"."unit_cost" >= 0),
	CONSTRAINT "stock_batches_source_ck" CHECK ("pos"."stock_batches"."source" in ('opening', 'purchase', 'adjustment'))
);
--> statement-breakpoint
ALTER TABLE "pos"."stock_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"ref_id" uuid,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_delta_ck" CHECK ("pos"."stock_movements"."delta" <> 0),
	CONSTRAINT "stock_movements_reason_ck" CHECK ("pos"."stock_movements"."reason" in ('opening', 'sale', 'sale_void', 'purchase', 'opname'))
);
--> statement-breakpoint
ALTER TABLE "pos"."stock_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."stock_batches" ADD CONSTRAINT "stock_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."stock_batches" ADD CONSTRAINT "stock_batches_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "pos"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "pos"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."stock_movements" ADD CONSTRAINT "stock_movements_batch_id_stock_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "pos"."stock_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_batches_fifo_idx" ON "pos"."stock_batches" USING btree ("tenant_id","product_id","received_at");--> statement-breakpoint
CREATE INDEX "stock_movements_product_idx" ON "pos"."stock_movements" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE INDEX "stock_movements_ref_idx" ON "pos"."stock_movements" USING btree ("ref_id");