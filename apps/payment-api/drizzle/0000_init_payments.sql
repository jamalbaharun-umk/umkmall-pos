CREATE TYPE "payment"."payment_status" AS ENUM('created', 'pending', 'paid', 'failed', 'expired', 'cancelled', 'voided', 'refund_pending', 'refunded', 'refund_failed');--> statement-breakpoint
CREATE TABLE "payment"."outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment"."outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment"."payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"from_status" "payment"."payment_status",
	"to_status" "payment"."payment_status" NOT NULL,
	"source" text NOT NULL,
	"actor_ref" text NOT NULL,
	"approved_by" text,
	"reason_code" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment"."payment_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment"."payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_ref" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"method" text NOT NULL,
	"amount" bigint NOT NULL,
	"status" "payment"."payment_status" NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"review_reason" text,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"provider_ref" text,
	"paid_receipt_ref" text,
	"fee_amount" bigint,
	"checkout" jsonb,
	"expires_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"not_found_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_non_negative" CHECK ("payment"."payments"."amount" >= 0),
	CONSTRAINT "payments_attempt_positive" CHECK ("payment"."payments"."attempt" >= 1)
);
--> statement-breakpoint
ALTER TABLE "payment"."payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment"."unmatched_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"receipt_ref" text NOT NULL,
	"kind" text NOT NULL,
	"gross_amount" bigint NOT NULL,
	"fee_amount" bigint DEFAULT 0 NOT NULL,
	"needs_review" boolean DEFAULT true NOT NULL,
	"refund_status" text DEFAULT 'none' NOT NULL,
	"refund_actor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment"."unmatched_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment"."webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"reference" text,
	"payment_id" uuid,
	"body" text NOT NULL,
	"state" text DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment"."webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment"."outbox" ADD CONSTRAINT "outbox_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "payment"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment"."payment_events" ADD CONSTRAINT "payment_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "payment"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment"."unmatched_receipts" ADD CONSTRAINT "unmatched_receipts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "payment"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment"."webhook_events" ADD CONSTRAINT "webhook_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "payment"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_undelivered" ON "payment"."outbox" USING btree ("created_at") WHERE "payment"."outbox"."delivered_at" is null;--> statement-breakpoint
CREATE INDEX "payment_events_tenant_payment" ON "payment"."payment_events" USING btree ("tenant_id","payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_tenant_idempotency_key" ON "payment"."payments" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_tenant_order_live" ON "payment"."payments" USING btree ("tenant_id","order_ref") WHERE "payment"."payments"."status" in ('created', 'pending', 'paid');--> statement-breakpoint
CREATE UNIQUE INDEX "payments_tenant_order_attempt" ON "payment"."payments" USING btree ("tenant_id","order_ref","attempt");--> statement-breakpoint
CREATE INDEX "payments_tenant_status_created" ON "payment"."payments" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "payments_in_flight" ON "payment"."payments" USING btree ("status","updated_at") WHERE "payment"."payments"."status" in ('created', 'pending', 'refund_pending');--> statement-breakpoint
CREATE UNIQUE INDEX "unmatched_receipts_payment_receipt" ON "payment"."unmatched_receipts" USING btree ("payment_id","receipt_ref");--> statement-breakpoint
CREATE INDEX "unmatched_receipts_tenant_review" ON "payment"."unmatched_receipts" USING btree ("tenant_id","needs_review");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_event" ON "payment"."webhook_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "webhook_events_retry" ON "payment"."webhook_events" USING btree ("state","next_attempt_at");