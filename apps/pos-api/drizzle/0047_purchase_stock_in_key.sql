ALTER TABLE "pos"."purchase_orders" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "pos"."purchase_orders" ADD COLUMN "request_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_tenant_key_uq" ON "pos"."purchase_orders" USING btree ("tenant_id","idempotency_key");