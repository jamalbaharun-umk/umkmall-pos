ALTER TABLE "pos"."sales" ALTER COLUMN "number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD COLUMN "hold_number" integer;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos"."sales_settings" ADD COLUMN "last_hold_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Every receipt so far was completed when it was paid.
UPDATE "pos"."sales" SET "completed_at" = "paid_at" WHERE "status" in ('completed', 'void');--> statement-breakpoint
-- A sale that awaits its payment right now gets a hold number, in the order the sales were rung up. It keeps
-- the receipt number it was created with: completing it uses that number, so no new gap is made.
UPDATE "pos"."sales" s SET "hold_number" = w.n
  FROM (SELECT "id", row_number() OVER (PARTITION BY "tenant_id" ORDER BY "created_at", "id") AS n
          FROM "pos"."sales" WHERE "status" = 'awaiting_payment') w
 WHERE s."id" = w."id";--> statement-breakpoint
UPDATE "pos"."sales_settings" ss SET "last_hold_number" = m.n
  FROM (SELECT "tenant_id", max("hold_number") AS n FROM "pos"."sales"
         WHERE "hold_number" IS NOT NULL GROUP BY "tenant_id") m
 WHERE ss."tenant_id" = m."tenant_id";--> statement-breakpoint
CREATE UNIQUE INDEX "sales_tenant_hold_number_uq" ON "pos"."sales" USING btree ("tenant_id","hold_number");--> statement-breakpoint
CREATE INDEX "sales_tenant_completed_idx" ON "pos"."sales" USING btree ("tenant_id","completed_at");--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD CONSTRAINT "sales_number_ck" CHECK (("pos"."sales"."status" not in ('completed', 'void') or ("pos"."sales"."number" is not null and "pos"."sales"."completed_at" is not null))
          and ("pos"."sales"."status" <> 'awaiting_payment' or "pos"."sales"."hold_number" is not null));