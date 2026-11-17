CREATE TABLE "pos"."payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_cash" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_methods_tenant_id_name_unique" UNIQUE("tenant_id","name"),
	CONSTRAINT "payment_methods_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "pos"."payment_methods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."sale_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"qty" integer NOT NULL,
	"list_price" bigint NOT NULL,
	"unit_price" bigint NOT NULL,
	"line_total" bigint NOT NULL,
	"cost_total" bigint NOT NULL,
	"price_overridden_by" uuid,
	CONSTRAINT "sale_lines_ck" CHECK ("pos"."sale_lines"."qty" > 0 and "pos"."sale_lines"."unit_price" >= 0 and "pos"."sale_lines"."line_total" = "pos"."sale_lines"."unit_price" * "pos"."sale_lines"."qty" and "pos"."sale_lines"."cost_total" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pos"."sale_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"shift_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"payment_method_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"subtotal" bigint NOT NULL,
	"discount" bigint DEFAULT 0 NOT NULL,
	"tax_bps" integer DEFAULT 0 NOT NULL,
	"tax" bigint DEFAULT 0 NOT NULL,
	"total" bigint NOT NULL,
	"paid" bigint NOT NULL,
	"change" bigint NOT NULL,
	"cost_total" bigint NOT NULL,
	"override_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "sales_money_ck" CHECK ("pos"."sales"."subtotal" >= 0 and "pos"."sales"."discount" between 0 and "pos"."sales"."subtotal" and "pos"."sales"."tax" >= 0
          and "pos"."sales"."total" = "pos"."sales"."subtotal" - "pos"."sales"."discount" + "pos"."sales"."tax"
          and "pos"."sales"."change" = "pos"."sales"."paid" - "pos"."sales"."total" and "pos"."sales"."change" >= 0 and "pos"."sales"."cost_total" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pos"."sales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."sales_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"tax_bps" integer DEFAULT 0 NOT NULL,
	"last_sale_number" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sales_settings_tax_ck" CHECK ("pos"."sales_settings"."tax_bps" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "pos"."sales_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"opening_cash" bigint NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"counted_cash" bigint,
	"expected_cash" bigint,
	"cash_sales" bigint,
	"sales_count" integer,
	CONSTRAINT "shifts_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "shifts_cash_ck" CHECK ("pos"."shifts"."opening_cash" >= 0 and ("pos"."shifts"."counted_cash" is null or "pos"."shifts"."counted_cash" >= 0))
);
--> statement-breakpoint
ALTER TABLE "pos"."shifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."payment_methods" ADD CONSTRAINT "payment_methods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."sale_lines" ADD CONSTRAINT "sale_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."sale_lines" ADD CONSTRAINT "sale_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "pos"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."sale_lines" ADD CONSTRAINT "sale_lines_tenant_id_sale_id_sales_tenant_id_id_fk" FOREIGN KEY ("tenant_id","sale_id") REFERENCES "pos"."sales"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD CONSTRAINT "sales_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD CONSTRAINT "sales_tenant_id_shift_id_shifts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","shift_id") REFERENCES "pos"."shifts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD CONSTRAINT "sales_tenant_id_payment_method_id_payment_methods_tenant_id_id_fk" FOREIGN KEY ("tenant_id","payment_method_id") REFERENCES "pos"."payment_methods"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."sales_settings" ADD CONSTRAINT "sales_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."shifts" ADD CONSTRAINT "shifts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_lines_sale_idx" ON "pos"."sale_lines" USING btree ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_tenant_idempotency_uq" ON "pos"."sales" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_tenant_number_uq" ON "pos"."sales" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "sales_tenant_created_idx" ON "pos"."sales" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "sales_shift_idx" ON "pos"."sales" USING btree ("shift_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_one_open_uq" ON "pos"."shifts" USING btree ("tenant_id","actor_id") WHERE "pos"."shifts"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "shifts_tenant_opened_idx" ON "pos"."shifts" USING btree ("tenant_id","opened_at");