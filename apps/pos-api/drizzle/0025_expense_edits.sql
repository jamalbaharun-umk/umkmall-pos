CREATE TABLE "pos"."expense_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"expense_id" uuid NOT NULL,
	"changes" jsonb NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pos"."expense_edits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."expense_edits" ADD CONSTRAINT "expense_edits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."expense_edits" ADD CONSTRAINT "expense_edits_tenant_id_expense_id_expenses_tenant_id_id_fk" FOREIGN KEY ("tenant_id","expense_id") REFERENCES "pos"."expenses"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_edits_expense_idx" ON "pos"."expense_edits" USING btree ("tenant_id","expense_id");