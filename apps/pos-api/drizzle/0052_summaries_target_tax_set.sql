ALTER TABLE "pos"."sales_settings" ADD COLUMN "daily_target" bigint;--> statement-breakpoint
ALTER TABLE "pos"."sales_settings" ADD COLUMN "tax_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos"."sales_settings" ADD CONSTRAINT "sales_settings_target_ck" CHECK ("pos"."sales_settings"."daily_target" is null or "pos"."sales_settings"."daily_target" > 0);--> statement-breakpoint
UPDATE "pos"."sales_settings" SET "tax_set_at" = now() WHERE "tax_bps" > 0;
