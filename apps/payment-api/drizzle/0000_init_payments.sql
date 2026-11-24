CREATE TYPE "payment"."payment_event_type" AS ENUM('charged', 'voided', 'refunded');--> statement-breakpoint
CREATE TYPE "payment"."payment_status" AS ENUM('pending', 'paid', 'failed', 'expired', 'voided', 'refunded');--> statement-breakpoint
CREATE TABLE "payment"."payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"type" "payment"."payment_event_type" NOT NULL,
	"actor_ref" text NOT NULL,
	"approved_by" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment"."payment_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment"."payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_ref" text NOT NULL,
	"method" text NOT NULL,
	"amount" bigint NOT NULL,
	"status" "payment"."payment_status" NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"provider_ref" text,
	"paid_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_non_negative" CHECK ("payment"."payments"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "payment"."payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment"."payment_events" ADD CONSTRAINT "payment_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "payment"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_events_tenant_payment" ON "payment"."payment_events" USING btree ("tenant_id","payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_tenant_idempotency_key" ON "payment"."payments" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_tenant_order_live" ON "payment"."payments" USING btree ("tenant_id","order_ref") WHERE "payment"."payments"."status" in ('pending', 'paid');--> statement-breakpoint
CREATE INDEX "payments_tenant_order" ON "payment"."payments" USING btree ("tenant_id","order_ref");--> statement-breakpoint
CREATE INDEX "payments_tenant_status_created" ON "payment"."payments" USING btree ("tenant_id","status","created_at");