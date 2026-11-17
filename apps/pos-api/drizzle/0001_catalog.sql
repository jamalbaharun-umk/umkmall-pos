CREATE TABLE "pos"."categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pos"."categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."product_barcodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pos"."product_barcodes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_images_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "pos"."product_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sku" text NOT NULL,
	"unit" text DEFAULT 'PCS' NOT NULL,
	"cost_price" bigint DEFAULT 0 NOT NULL,
	"selling_price" bigint NOT NULL,
	"type" text DEFAULT 'product' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_prices_ck" CHECK ("pos"."products"."cost_price" >= 0 and "pos"."products"."selling_price" >= 0),
	CONSTRAINT "products_type_ck" CHECK ("pos"."products"."type" in ('product', 'service', 'non_stock')),
	CONSTRAINT "products_sku_ck" CHECK ("pos"."products"."sku" !~ '\s')
);
--> statement-breakpoint
ALTER TABLE "pos"."products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."categories" ADD CONSTRAINT "categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."product_barcodes" ADD CONSTRAINT "product_barcodes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."product_barcodes" ADD CONSTRAINT "product_barcodes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "pos"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."product_images" ADD CONSTRAINT "product_images_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "pos"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "pos"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_tenant_name_uq" ON "pos"."categories" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "product_barcodes_tenant_code_uq" ON "pos"."product_barcodes" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "product_barcodes_product_idx" ON "pos"."product_barcodes" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_images_product_idx" ON "pos"."product_images" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_sku_uq" ON "pos"."products" USING btree ("tenant_id","sku") WHERE "pos"."products"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "products_tenant_category_idx" ON "pos"."products" USING btree ("tenant_id","category_id");