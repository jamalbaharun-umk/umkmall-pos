CREATE TABLE "pos"."purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_cost" bigint NOT NULL,
	CONSTRAINT "purchase_order_lines_ck" CHECK ("pos"."purchase_order_lines"."qty" > 0 and "pos"."purchase_order_lines"."unit_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pos"."purchase_order_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"payment_method" text,
	"note" text,
	"total" bigint DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_status_ck" CHECK ("pos"."purchase_orders"."status" in ('draft', 'approved', 'cancelled')),
	CONSTRAINT "purchase_orders_total_ck" CHECK ("pos"."purchase_orders"."total" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pos"."purchase_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."stock_opname_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"opname_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"counted_qty" integer NOT NULL,
	"system_qty" integer NOT NULL,
	"reason" text,
	CONSTRAINT "stock_opname_lines_ck" CHECK ("pos"."stock_opname_lines"."counted_qty" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pos"."stock_opname_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."stock_opnames" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_opnames_status_ck" CHECK ("pos"."stock_opnames"."status" in ('draft', 'approved'))
);
--> statement-breakpoint
ALTER TABLE "pos"."stock_opnames" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"address" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pos"."suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "pos"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "pos"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "pos"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."stock_opname_lines" ADD CONSTRAINT "stock_opname_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."stock_opname_lines" ADD CONSTRAINT "stock_opname_lines_opname_id_stock_opnames_id_fk" FOREIGN KEY ("opname_id") REFERENCES "pos"."stock_opnames"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."stock_opname_lines" ADD CONSTRAINT "stock_opname_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "pos"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."stock_opnames" ADD CONSTRAINT "stock_opnames_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."suppliers" ADD CONSTRAINT "suppliers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_order_lines_order_idx" ON "pos"."purchase_order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_tenant_idx" ON "pos"."purchase_orders" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_opname_lines_product_uq" ON "pos"."stock_opname_lines" USING btree ("opname_id","product_id");--> statement-breakpoint
CREATE INDEX "stock_opnames_tenant_idx" ON "pos"."stock_opnames" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "suppliers_tenant_idx" ON "pos"."suppliers" USING btree ("tenant_id");