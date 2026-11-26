CREATE TABLE "pos"."discount_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"approver_id" uuid NOT NULL,
	"approver_kind" text NOT NULL,
	"product_id" uuid NOT NULL,
	"max_bps" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"sale_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_approvals_ck" CHECK ("pos"."discount_approvals"."max_bps" between 1 and 9999 and ("pos"."discount_approvals"."used_at" is null) = ("pos"."discount_approvals"."sale_id" is null))
);
--> statement-breakpoint
ALTER TABLE "pos"."discount_approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."sale_lines" ADD COLUMN "discount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos"."sale_lines" ADD COLUMN "discount_percent" integer;--> statement-breakpoint
ALTER TABLE "pos"."sale_lines" ADD COLUMN "discount_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD COLUMN "line_discount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos"."discount_approvals" ADD CONSTRAINT "discount_approvals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."discount_approvals" ADD CONSTRAINT "discount_approvals_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "pos"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."discount_approvals" ADD CONSTRAINT "discount_approvals_tenant_id_sale_id_sales_tenant_id_id_fk" FOREIGN KEY ("tenant_id","sale_id") REFERENCES "pos"."sales"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discount_approvals_tenant_actor_idx" ON "pos"."discount_approvals" USING btree ("tenant_id","actor_id");--> statement-breakpoint
ALTER TABLE "pos"."sale_lines" ADD CONSTRAINT "sale_lines_discount_ck" CHECK ("pos"."sale_lines"."discount" >= 0 and ("pos"."sale_lines"."discount" = 0 or "pos"."sale_lines"."discount" < "pos"."sale_lines"."line_total")
          and ("pos"."sale_lines"."discount_percent" is null or "pos"."sale_lines"."discount_percent" between 1 and 99));--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD CONSTRAINT "sales_line_discount_ck" CHECK ("pos"."sales"."line_discount" >= 0 and "pos"."sales"."line_discount" <= "pos"."sales"."discount");