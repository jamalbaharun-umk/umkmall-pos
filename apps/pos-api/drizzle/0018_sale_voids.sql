CREATE TABLE "pos"."sale_void_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"void_id" uuid NOT NULL,
	"receivable_payment_id" uuid,
	"payment_method_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"from_drawer" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_void_returns_ck" CHECK ("pos"."sale_void_returns"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "pos"."sale_void_returns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."sale_voids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"reason_code" text NOT NULL,
	"note" text,
	"actor_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"approved_by" uuid NOT NULL,
	"approved_by_kind" text NOT NULL,
	"shift_id" uuid,
	"cash_returned" bigint DEFAULT 0 NOT NULL,
	"transfer_returned" bigint DEFAULT 0 NOT NULL,
	"receivable_cancelled" bigint DEFAULT 0 NOT NULL,
	"subtotal" bigint NOT NULL,
	"discount" bigint NOT NULL,
	"voucher_discount" bigint NOT NULL,
	"tax" bigint NOT NULL,
	"total" bigint NOT NULL,
	"cost_total" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_voids_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "sale_voids_ck" CHECK ("pos"."sale_voids"."cash_returned" >= 0 and "pos"."sale_voids"."transfer_returned" >= 0 and "pos"."sale_voids"."receivable_cancelled" >= 0
          and "pos"."sale_voids"."cash_returned" + "pos"."sale_voids"."transfer_returned" + "pos"."sale_voids"."receivable_cancelled" = "pos"."sale_voids"."total"
          and ("pos"."sale_voids"."cash_returned" = 0 or "pos"."sale_voids"."shift_id" is not null)
          and ("pos"."sale_voids"."reason_code" <> 'other' or "pos"."sale_voids"."note" is not null))
);
--> statement-breakpoint
ALTER TABLE "pos"."sale_voids" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."void_pins" (
	"tenant_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"pin_hash" text NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"unlocked_at" timestamp with time zone,
	"unlocked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "void_pins_tenant_id_actor_id_pk" PRIMARY KEY("tenant_id","actor_id"),
	CONSTRAINT "void_pins_ck" CHECK ("pos"."void_pins"."failures" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pos"."void_pins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD COLUMN "status" text DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos"."receivables" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos"."receivables" ADD COLUMN "cancelled_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos"."receivable_payments" ADD CONSTRAINT "receivable_payments_tenant_id_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "pos"."sale_void_returns" ADD CONSTRAINT "sale_void_returns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."sale_void_returns" ADD CONSTRAINT "sale_void_returns_tenant_id_void_id_sale_voids_tenant_id_id_fk" FOREIGN KEY ("tenant_id","void_id") REFERENCES "pos"."sale_voids"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."sale_void_returns" ADD CONSTRAINT "sale_void_returns_receivable_payment_fk" FOREIGN KEY ("tenant_id","receivable_payment_id") REFERENCES "pos"."receivable_payments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."sale_void_returns" ADD CONSTRAINT "sale_void_returns_tenant_id_payment_method_id_payment_methods_tenant_id_id_fk" FOREIGN KEY ("tenant_id","payment_method_id") REFERENCES "pos"."payment_methods"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."sale_voids" ADD CONSTRAINT "sale_voids_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."sale_voids" ADD CONSTRAINT "sale_voids_tenant_id_sale_id_sales_tenant_id_id_fk" FOREIGN KEY ("tenant_id","sale_id") REFERENCES "pos"."sales"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."sale_voids" ADD CONSTRAINT "sale_voids_tenant_id_shift_id_shifts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","shift_id") REFERENCES "pos"."shifts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."void_pins" ADD CONSTRAINT "void_pins_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_void_returns_void_idx" ON "pos"."sale_void_returns" USING btree ("tenant_id","void_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_voids_sale_uq" ON "pos"."sale_voids" USING btree ("tenant_id","sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_voids_tenant_key_uq" ON "pos"."sale_voids" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "sale_voids_tenant_created_idx" ON "pos"."sale_voids" USING btree ("tenant_id","created_at");--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD CONSTRAINT "sales_status_ck" CHECK ("pos"."sales"."status" in ('completed', 'void') and ("pos"."sales"."status" = 'void') = ("pos"."sales"."voided_at" is not null));--> statement-breakpoint
ALTER TABLE "pos"."receivables" ADD CONSTRAINT "receivables_cancel_ck" CHECK ("pos"."receivables"."cancelled_amount" between 0 and "pos"."receivables"."total"
          and ("pos"."receivables"."cancelled_at" is not null or "pos"."receivables"."cancelled_amount" = 0)
          and ("pos"."receivables"."cancelled_at" is null or "pos"."receivables"."rest" = 0));