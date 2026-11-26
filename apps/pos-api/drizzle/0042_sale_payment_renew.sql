ALTER TABLE "pos"."sales" DROP CONSTRAINT "sales_attempt_ck";--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD COLUMN "payment_renew_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD CONSTRAINT "sales_attempt_ck" CHECK ("pos"."sales"."payment_attempt" >= 1 and ("pos"."sales"."switch_cash_paid" is null or "pos"."sales"."status" = 'awaiting_payment')
          and ("pos"."sales"."payment_renew_at" is null or ("pos"."sales"."status" = 'awaiting_payment' and "pos"."sales"."switch_cash_paid" is null)));