ALTER TABLE "pos"."payment_methods" DROP CONSTRAINT "payment_methods_kind_ck";--> statement-breakpoint
ALTER TABLE "pos"."payment_methods" ADD COLUMN "is_online" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pos"."payment_methods" ADD COLUMN "gateway_method" text;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD COLUMN "payment_attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD COLUMN "payment_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD COLUMN "switch_cash_paid" bigint;--> statement-breakpoint
ALTER TABLE "pos"."sale_voids" ADD COLUMN "refund_status" text;--> statement-breakpoint
CREATE INDEX "sale_voids_refund_pending_idx" ON "pos"."sale_voids" USING btree ("created_at") WHERE "pos"."sale_voids"."refund_status" = 'pending';--> statement-breakpoint
ALTER TABLE "pos"."payment_methods" ADD CONSTRAINT "payment_methods_online_ck" CHECK ("pos"."payment_methods"."is_online" = ("pos"."payment_methods"."gateway_method" is not null));--> statement-breakpoint
ALTER TABLE "pos"."payment_methods" ADD CONSTRAINT "payment_methods_kind_ck" CHECK ("pos"."payment_methods"."is_cash"::int + "pos"."payment_methods"."is_debit"::int + "pos"."payment_methods"."is_credit"::int + "pos"."payment_methods"."is_wallet"::int + "pos"."payment_methods"."is_online"::int = 1);--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD CONSTRAINT "sales_attempt_ck" CHECK ("pos"."sales"."payment_attempt" >= 1 and ("pos"."sales"."switch_cash_paid" is null or "pos"."sales"."status" = 'awaiting_payment'));--> statement-breakpoint
ALTER TABLE "pos"."sale_voids" ADD CONSTRAINT "sale_voids_refund_ck" CHECK ("pos"."sale_voids"."refund_status" is null or "pos"."sale_voids"."refund_status" in ('pending', 'succeeded', 'failed'));