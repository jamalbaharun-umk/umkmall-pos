ALTER TABLE "pos"."stock_batches" ADD COLUMN "expires_at" date;--> statement-breakpoint
ALTER TABLE "pos"."purchase_order_lines" ADD COLUMN "expires_at" date;