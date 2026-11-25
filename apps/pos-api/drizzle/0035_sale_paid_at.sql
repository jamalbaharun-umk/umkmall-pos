ALTER TABLE "pos"."sales" ADD COLUMN "paid_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Every sale so far was paid when it was rung up; the default above stamped them with this migration's time.
UPDATE "pos"."sales" SET "paid_at" = "created_at";--> statement-breakpoint
CREATE INDEX "sales_tenant_paid_idx" ON "pos"."sales" USING btree ("tenant_id","paid_at");