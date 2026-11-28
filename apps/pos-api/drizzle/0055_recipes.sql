CREATE TABLE "pos"."ingredient_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"cost" bigint NOT NULL,
	"per_qty" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingredient_costs_ck" CHECK ("pos"."ingredient_costs"."cost" >= 0 and "pos"."ingredient_costs"."per_qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "pos"."ingredient_costs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."recipe_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"ingredient_id" uuid,
	"sub_recipe_id" uuid,
	"quantity" integer NOT NULL,
	"waste_percent" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "recipe_lines_ck" CHECK ("pos"."recipe_lines"."quantity" > 0 and "pos"."recipe_lines"."waste_percent" between 0 and 90
          and num_nonnulls("pos"."recipe_lines"."ingredient_id", "pos"."recipe_lines"."sub_recipe_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "pos"."recipe_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"yield_qty" integer NOT NULL,
	"yield_unit" text DEFAULT 'porsi' NOT NULL,
	"labor_cost" bigint DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipes_ck" CHECK ("pos"."recipes"."yield_qty" > 0 and "pos"."recipes"."labor_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pos"."recipes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."products" DROP CONSTRAINT "products_type_ck";--> statement-breakpoint
ALTER TABLE "pos"."ingredient_costs" ADD CONSTRAINT "ingredient_costs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."ingredient_costs" ADD CONSTRAINT "ingredient_costs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "pos"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."recipe_lines" ADD CONSTRAINT "recipe_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."recipe_lines" ADD CONSTRAINT "recipe_lines_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "pos"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."recipe_lines" ADD CONSTRAINT "recipe_lines_ingredient_id_products_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "pos"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."recipe_lines" ADD CONSTRAINT "recipe_lines_sub_recipe_id_recipes_id_fk" FOREIGN KEY ("sub_recipe_id") REFERENCES "pos"."recipes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."recipes" ADD CONSTRAINT "recipes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."recipes" ADD CONSTRAINT "recipes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "pos"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ingredient_costs_tenant_product_uq" ON "pos"."ingredient_costs" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE INDEX "recipe_lines_recipe_idx" ON "pos"."recipe_lines" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "recipe_lines_tenant_idx" ON "pos"."recipe_lines" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "recipe_lines_sub_recipe_idx" ON "pos"."recipe_lines" USING btree ("sub_recipe_id");--> statement-breakpoint
CREATE INDEX "recipe_lines_ingredient_idx" ON "pos"."recipe_lines" USING btree ("ingredient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipes_tenant_product_uq" ON "pos"."recipes" USING btree ("tenant_id","product_id");--> statement-breakpoint
ALTER TABLE "pos"."products" ADD CONSTRAINT "products_type_ck" CHECK ("pos"."products"."type" in ('product', 'service', 'non_stock', 'ingredient'));