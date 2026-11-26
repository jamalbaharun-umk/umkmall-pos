ALTER TABLE "pos"."receivable_payments" DROP CONSTRAINT "receivable_payments_ck";--> statement-breakpoint
ALTER TABLE "pos"."receivable_payments" ADD COLUMN "reverses_id" uuid;--> statement-breakpoint
ALTER TABLE "pos"."receivable_payments" ADD COLUMN "replaces_id" uuid;--> statement-breakpoint
ALTER TABLE "pos"."receivable_payments" ADD COLUMN "reason_code" text;--> statement-breakpoint
ALTER TABLE "pos"."receivable_payments" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "pos"."receivable_payments" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "pos"."receivable_payments" ADD COLUMN "approved_by_kind" text;--> statement-breakpoint
ALTER TABLE "pos"."receivable_payments" ADD COLUMN "payment_sync_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pos"."receivable_payments" ADD CONSTRAINT "receivable_payments_reverses_fk" FOREIGN KEY ("tenant_id","reverses_id") REFERENCES "pos"."receivable_payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."receivable_payments" ADD CONSTRAINT "receivable_payments_replaces_fk" FOREIGN KEY ("tenant_id","replaces_id") REFERENCES "pos"."receivable_payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "receivable_payments_reverses_uq" ON "pos"."receivable_payments" USING btree ("tenant_id","reverses_id") WHERE "pos"."receivable_payments"."reverses_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "receivable_payments_replaces_uq" ON "pos"."receivable_payments" USING btree ("tenant_id","replaces_id") WHERE "pos"."receivable_payments"."replaces_id" is not null;--> statement-breakpoint
ALTER TABLE "pos"."receivable_payments" ADD CONSTRAINT "receivable_payments_ck" CHECK (("pos"."receivable_payments"."reverses_id" is null and "pos"."receivable_payments"."amount" > 0 and "pos"."receivable_payments"."amount" <= "pos"."receivable_payments"."rest_before")
          or ("pos"."receivable_payments"."reverses_id" is not null and "pos"."receivable_payments"."amount" < 0 and "pos"."receivable_payments"."replaces_id" is null and "pos"."receivable_payments"."seq" is null
            and "pos"."receivable_payments"."reason_code" is not null and "pos"."receivable_payments"."approved_by" is not null and "pos"."receivable_payments"."approved_by_kind" is not null));