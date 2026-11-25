ALTER TABLE "pos"."sales" DROP CONSTRAINT "sales_status_ck";--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD COLUMN "payment_id" uuid;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos"."receivable_payments" ADD COLUMN "seq" integer;--> statement-breakpoint
ALTER TABLE "pos"."receivable_payments" ADD COLUMN "payment_id" uuid;--> statement-breakpoint
ALTER TABLE "pos"."sale_voids" ADD COLUMN "payment_sync_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "sales_awaiting_idx" ON "pos"."sales" USING btree ("created_at") WHERE "pos"."sales"."status" = 'awaiting_payment';--> statement-breakpoint
CREATE UNIQUE INDEX "receivable_payments_seq_uq" ON "pos"."receivable_payments" USING btree ("tenant_id","receivable_id","seq") WHERE "pos"."receivable_payments"."seq" is not null;--> statement-breakpoint
CREATE INDEX "receivable_payments_unrecorded_idx" ON "pos"."receivable_payments" USING btree ("created_at") WHERE "pos"."receivable_payments"."seq" is not null and "pos"."receivable_payments"."payment_id" is null;--> statement-breakpoint
CREATE INDEX "sale_voids_payment_sync_idx" ON "pos"."sale_voids" USING btree ("created_at") WHERE "pos"."sale_voids"."payment_sync_pending";--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD CONSTRAINT "sales_status_ck" CHECK ("pos"."sales"."status" in ('completed', 'void', 'awaiting_payment', 'cancelled')
          and ("pos"."sales"."status" = 'void') = ("pos"."sales"."voided_at" is not null)
          and ("pos"."sales"."status" = 'cancelled') = ("pos"."sales"."cancelled_at" is not null));