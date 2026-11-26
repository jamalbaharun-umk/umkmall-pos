DROP INDEX "pos"."sales_tenant_hold_number_uq";--> statement-breakpoint
DROP INDEX "pos"."sales_tenant_completed_idx";--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD COLUMN "hold_day" date;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD COLUMN "settled_by_job" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "pos"."sales_settings" ADD COLUMN "hold_number_day" date;--> statement-breakpoint
-- Hold numbers so far were counted without a day: each keeps its number, dated at the store day it was rung up.
UPDATE "pos"."sales" SET "hold_day" = ("created_at" AT TIME ZONE 'Asia/Jakarta')::date WHERE "hold_number" IS NOT NULL;--> statement-breakpoint
-- A counter in use goes on counting today (a 1 taken today could meet a 1 of this morning) and starts at 1 tomorrow.
UPDATE "pos"."sales_settings" SET "hold_number_day" = (now() AT TIME ZONE 'Asia/Jakarta')::date WHERE "last_hold_number" > 0;--> statement-breakpoint
-- A sale that was waiting when sale_hold_number ran kept the receipt number it was created with. It is not a
-- receipt: the number goes, and completing it takes the next one like every other sale (PR 29 review).
UPDATE "pos"."sales" SET "number" = NULL WHERE "status" = 'awaiting_payment' AND "number" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_tenant_hold_day_number_uq" ON "pos"."sales" USING btree ("tenant_id","hold_day","hold_number");--> statement-breakpoint
CREATE INDEX "sales_tenant_ended_idx" ON "pos"."sales" USING btree ("tenant_id",coalesce("cancelled_at", "completed_at"),"id");--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD CONSTRAINT "sales_hold_day_ck" CHECK (("pos"."sales"."hold_number" is null) = ("pos"."sales"."hold_day" is null)
          and ("pos"."sales"."cancel_reason" is null or "pos"."sales"."status" = 'cancelled'));