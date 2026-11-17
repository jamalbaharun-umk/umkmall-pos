ALTER TABLE "pos"."payment_methods" DROP CONSTRAINT "payment_methods_tenant_id_name_unique";--> statement-breakpoint
ALTER TABLE "pos"."receivable_payments" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "pos"."receivable_payments" ADD COLUMN "request_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_tenant_name_uq" ON "pos"."payment_methods" USING btree ("tenant_id","name") WHERE "pos"."payment_methods"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "receivable_payments_tenant_key_uq" ON "pos"."receivable_payments" USING btree ("tenant_id","idempotency_key") WHERE "pos"."receivable_payments"."idempotency_key" is not null;