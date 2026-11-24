ALTER TABLE "pos"."sales" DROP CONSTRAINT "sales_money_ck";--> statement-breakpoint
ALTER TABLE "pos"."sale_voids" DROP CONSTRAINT "sale_voids_ck";--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD COLUMN "rounding" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos"."sale_voids" ADD COLUMN "rounding" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD CONSTRAINT "sales_money_ck" CHECK ("pos"."sales"."subtotal" >= 0 and "pos"."sales"."discount" >= 0 and "pos"."sales"."voucher_discount" >= 0
          and "pos"."sales"."discount" + "pos"."sales"."voucher_discount" <= "pos"."sales"."subtotal" and "pos"."sales"."tax" >= 0
          and "pos"."sales"."total" = "pos"."sales"."subtotal" - "pos"."sales"."discount" - "pos"."sales"."voucher_discount" + "pos"."sales"."tax"
          and "pos"."sales"."rounding" between 0 and 99
          and ("pos"."sales"."rounding" = 0 or ("pos"."sales"."total" + "pos"."sales"."rounding") % 100 = 0)
          and "pos"."sales"."change" = greatest("pos"."sales"."paid" - "pos"."sales"."total" - "pos"."sales"."rounding", 0) and "pos"."sales"."cost_total" >= 0
          and ("pos"."sales"."paid" >= "pos"."sales"."total" + "pos"."sales"."rounding" or "pos"."sales"."member_id" is not null));--> statement-breakpoint
ALTER TABLE "pos"."sale_voids" ADD CONSTRAINT "sale_voids_ck" CHECK ("pos"."sale_voids"."cash_returned" >= 0 and "pos"."sale_voids"."transfer_returned" >= 0 and "pos"."sale_voids"."receivable_cancelled" >= 0
          and "pos"."sale_voids"."cash_returned" + "pos"."sale_voids"."transfer_returned" + "pos"."sale_voids"."receivable_cancelled" = "pos"."sale_voids"."total" + "pos"."sale_voids"."rounding"
          and "pos"."sale_voids"."rounding" between 0 and 99
          and ("pos"."sale_voids"."cash_returned" = 0 or "pos"."sale_voids"."shift_id" is not null)
          and ("pos"."sale_voids"."reason_code" <> 'other' or "pos"."sale_voids"."note" is not null));