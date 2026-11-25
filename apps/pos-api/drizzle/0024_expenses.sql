CREATE TABLE "pos"."expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"amount" bigint NOT NULL,
	"note" text,
	"expense_date" date NOT NULL,
	"source" text NOT NULL,
	"shift_id" uuid,
	"drawer_cash_before" bigint,
	"actor_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	"updated_by_kind" text,
	"voided_at" timestamp with time zone,
	"voided_by_id" uuid,
	"voided_by_kind" text,
	"void_reason" text,
	"drawer_reversed" boolean,
	CONSTRAINT "expenses_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "expenses_amount_ck" CHECK ("pos"."expenses"."amount" > 0),
	CONSTRAINT "expenses_kind_ck" CHECK (("pos"."expenses"."kind" = 'supplier_payment') = ("pos"."expenses"."category" = 'bayar_pemasok')),
	CONSTRAINT "expenses_source_ck" CHECK (("pos"."expenses"."source" = 'drawer') = ("pos"."expenses"."shift_id" is not null)
          and ("pos"."expenses"."source" = 'drawer') = ("pos"."expenses"."drawer_cash_before" is not null)),
	CONSTRAINT "expenses_void_ck" CHECK (("pos"."expenses"."voided_at" is null) = ("pos"."expenses"."voided_by_id" is null)
          and ("pos"."expenses"."voided_at" is null) = ("pos"."expenses"."voided_by_kind" is null)
          and ("pos"."expenses"."voided_at" is not null or "pos"."expenses"."void_reason" is null)
          and ("pos"."expenses"."drawer_reversed" is not null) = ("pos"."expenses"."voided_at" is not null and "pos"."expenses"."source" = 'drawer'))
);
--> statement-breakpoint
ALTER TABLE "pos"."expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."expenses" ADD CONSTRAINT "expenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."expenses" ADD CONSTRAINT "expenses_tenant_id_shift_id_shifts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","shift_id") REFERENCES "pos"."shifts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_tenant_date_idx" ON "pos"."expenses" USING btree ("tenant_id","expense_date");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_tenant_key_uq" ON "pos"."expenses" USING btree ("tenant_id","idempotency_key");