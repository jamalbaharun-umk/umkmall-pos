ALTER TABLE "pos"."discount_approvals" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pos"."discount_approvals" ADD COLUMN "scope" text DEFAULT 'line' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD COLUMN "discount_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "pos"."discount_approvals" ADD CONSTRAINT "discount_approvals_scope_ck" CHECK ("pos"."discount_approvals"."scope" in ('line', 'order') and ("pos"."discount_approvals"."scope" = 'order') = ("pos"."discount_approvals"."product_id" is null));