CREATE TABLE "pos"."members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"phone" text,
	"address" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "pos"."members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."vouchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"type" text NOT NULL,
	"nominal" bigint NOT NULL,
	"kuota" integer NOT NULL,
	"start_date" date NOT NULL,
	"expired" date NOT NULL,
	"minimal_buying" bigint DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vouchers_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "vouchers_ck" CHECK ("pos"."vouchers"."kuota" >= 0 and "pos"."vouchers"."minimal_buying" >= 0 and "pos"."vouchers"."nominal" > 0
          and ("pos"."vouchers"."type" <> 'percentage' or "pos"."vouchers"."nominal" <= 100) and "pos"."vouchers"."expired" >= "pos"."vouchers"."start_date")
);
--> statement-breakpoint
ALTER TABLE "pos"."vouchers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."receivable_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"receivable_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"payment_method_id" uuid NOT NULL,
	"rest_before" bigint NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receivable_payments_ck" CHECK ("pos"."receivable_payments"."amount" > 0 and "pos"."receivable_payments"."amount" <= "pos"."receivable_payments"."rest_before")
);
--> statement-breakpoint
ALTER TABLE "pos"."receivable_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."receivables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"total" bigint NOT NULL,
	"rest" bigint NOT NULL,
	"due_date" date NOT NULL,
	"last_payment_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receivables_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "receivables_ck" CHECK ("pos"."receivables"."total" > 0 and "pos"."receivables"."rest" between 0 and "pos"."receivables"."total")
);
--> statement-breakpoint
ALTER TABLE "pos"."receivables" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."sales" DROP CONSTRAINT "sales_money_ck";--> statement-breakpoint
ALTER TABLE "pos"."payment_methods" ADD COLUMN "is_debit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pos"."payment_methods" ADD COLUMN "is_credit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pos"."payment_methods" ADD COLUMN "is_wallet" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pos"."payment_methods" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD COLUMN "member_id" uuid;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD COLUMN "voucher_id" uuid;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD COLUMN "voucher_discount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos"."members" ADD CONSTRAINT "members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."vouchers" ADD CONSTRAINT "vouchers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."receivable_payments" ADD CONSTRAINT "receivable_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."receivable_payments" ADD CONSTRAINT "receivable_payments_tenant_id_receivable_id_receivables_tenant_id_id_fk" FOREIGN KEY ("tenant_id","receivable_id") REFERENCES "pos"."receivables"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."receivable_payments" ADD CONSTRAINT "receivable_payments_tenant_id_payment_method_id_payment_methods_tenant_id_id_fk" FOREIGN KEY ("tenant_id","payment_method_id") REFERENCES "pos"."payment_methods"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."receivables" ADD CONSTRAINT "receivables_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."receivables" ADD CONSTRAINT "receivables_tenant_id_sale_id_sales_tenant_id_id_fk" FOREIGN KEY ("tenant_id","sale_id") REFERENCES "pos"."sales"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."receivables" ADD CONSTRAINT "receivables_tenant_id_member_id_members_tenant_id_id_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "pos"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "members_tenant_code_uq" ON "pos"."members" USING btree ("tenant_id","code") WHERE "pos"."members"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "vouchers_tenant_code_uq" ON "pos"."vouchers" USING btree ("tenant_id","code") WHERE "pos"."vouchers"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "receivable_payments_receivable_idx" ON "pos"."receivable_payments" USING btree ("receivable_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receivables_sale_uq" ON "pos"."receivables" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "receivables_tenant_member_idx" ON "pos"."receivables" USING btree ("tenant_id","member_id");--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD CONSTRAINT "sales_tenant_id_member_id_members_tenant_id_id_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "pos"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD CONSTRAINT "sales_tenant_id_voucher_id_vouchers_tenant_id_id_fk" FOREIGN KEY ("tenant_id","voucher_id") REFERENCES "pos"."vouchers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."payment_methods" ADD CONSTRAINT "payment_methods_kind_ck" CHECK ("pos"."payment_methods"."is_cash"::int + "pos"."payment_methods"."is_debit"::int + "pos"."payment_methods"."is_credit"::int + "pos"."payment_methods"."is_wallet"::int = 1);--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD CONSTRAINT "sales_money_ck" CHECK ("pos"."sales"."subtotal" >= 0 and "pos"."sales"."discount" >= 0 and "pos"."sales"."voucher_discount" >= 0
          and "pos"."sales"."discount" + "pos"."sales"."voucher_discount" <= "pos"."sales"."subtotal" and "pos"."sales"."tax" >= 0
          and "pos"."sales"."total" = "pos"."sales"."subtotal" - "pos"."sales"."discount" - "pos"."sales"."voucher_discount" + "pos"."sales"."tax"
          and "pos"."sales"."change" = greatest("pos"."sales"."paid" - "pos"."sales"."total", 0) and "pos"."sales"."cost_total" >= 0
          and ("pos"."sales"."paid" >= "pos"."sales"."total" or "pos"."sales"."member_id" is not null));