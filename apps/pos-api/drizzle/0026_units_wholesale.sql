CREATE TABLE "pos"."product_price_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"min_qty" integer NOT NULL,
	"price" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_price_tiers_ck" CHECK ("pos"."product_price_tiers"."min_qty" >= 2 and "pos"."product_price_tiers"."price" > 0)
);
--> statement-breakpoint
ALTER TABLE "pos"."product_price_tiers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."product_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit_qty" integer NOT NULL,
	"price" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_units_ck" CHECK ("pos"."product_units"."unit_qty" >= 2 and "pos"."product_units"."price" > 0)
);
--> statement-breakpoint
ALTER TABLE "pos"."product_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."sale_lines" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "pos"."sale_lines" ADD COLUMN "unit_qty" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos"."sale_lines" ADD COLUMN "base_qty" integer GENERATED ALWAYS AS (qty * unit_qty) STORED;--> statement-breakpoint
ALTER TABLE "pos"."sale_lines" ADD COLUMN "normal_unit_price" bigint;--> statement-breakpoint
ALTER TABLE "pos"."sale_lines" ADD COLUMN "applied_tier_min_qty" integer;--> statement-breakpoint
ALTER TABLE "pos"."product_price_tiers" ADD CONSTRAINT "product_price_tiers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."product_price_tiers" ADD CONSTRAINT "product_price_tiers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "pos"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."product_units" ADD CONSTRAINT "product_units_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."product_units" ADD CONSTRAINT "product_units_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "pos"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_price_tiers_product_min_uq" ON "pos"."product_price_tiers" USING btree ("product_id","min_qty");--> statement-breakpoint
CREATE INDEX "product_price_tiers_tenant_idx" ON "pos"."product_price_tiers" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_units_product_name_uq" ON "pos"."product_units" USING btree ("product_id",lower("name"));--> statement-breakpoint
CREATE INDEX "product_units_tenant_idx" ON "pos"."product_units" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "pos"."sale_lines" ADD CONSTRAINT "sale_lines_unit_ck" CHECK ("pos"."sale_lines"."unit_qty" >= 1);