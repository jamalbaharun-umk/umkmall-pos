CREATE TABLE "pos"."production_run_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"cost" bigint NOT NULL,
	CONSTRAINT "production_run_lines_ck" CHECK ("pos"."production_run_lines"."quantity" > 0 and "pos"."production_run_lines"."cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pos"."production_run_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."production_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recipe_id" uuid,
	"product_id" uuid NOT NULL,
	"batches" integer NOT NULL,
	"planned_yield" integer NOT NULL,
	"actual_yield" integer NOT NULL,
	"yield_unit" text NOT NULL,
	"ingredient_cost" bigint NOT NULL,
	"cost_per_portion" bigint NOT NULL,
	"batch_id" uuid NOT NULL,
	"note" text,
	"actor_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_runs_ck" CHECK ("pos"."production_runs"."batches" > 0 and "pos"."production_runs"."planned_yield" > 0 and "pos"."production_runs"."actual_yield" > 0
          and "pos"."production_runs"."ingredient_cost" >= 0 and "pos"."production_runs"."cost_per_portion" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pos"."production_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."stock_batches" DROP CONSTRAINT "stock_batches_source_ck";--> statement-breakpoint
ALTER TABLE "pos"."stock_movements" DROP CONSTRAINT "stock_movements_reason_ck";--> statement-breakpoint
ALTER TABLE "pos"."production_run_lines" ADD CONSTRAINT "production_run_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."production_run_lines" ADD CONSTRAINT "production_run_lines_run_id_production_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "pos"."production_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."production_run_lines" ADD CONSTRAINT "production_run_lines_ingredient_id_products_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "pos"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."production_runs" ADD CONSTRAINT "production_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."production_runs" ADD CONSTRAINT "production_runs_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "pos"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."production_runs" ADD CONSTRAINT "production_runs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "pos"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."production_runs" ADD CONSTRAINT "production_runs_batch_id_stock_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "pos"."stock_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "production_run_lines_run_idx" ON "pos"."production_run_lines" USING btree ("tenant_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_runs_tenant_key_uq" ON "pos"."production_runs" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "production_runs_tenant_created_idx" ON "pos"."production_runs" USING btree ("tenant_id","created_at");--> statement-breakpoint
ALTER TABLE "pos"."stock_batches" ADD CONSTRAINT "stock_batches_source_ck" CHECK ("pos"."stock_batches"."source" in ('opening', 'purchase', 'adjustment', 'production'));--> statement-breakpoint
ALTER TABLE "pos"."stock_movements" ADD CONSTRAINT "stock_movements_reason_ck" CHECK ("pos"."stock_movements"."reason" in ('opening', 'sale', 'sale_void', 'purchase', 'opname', 'purchase_return', 'purchase_return_reversal', 'production', 'production_use'));