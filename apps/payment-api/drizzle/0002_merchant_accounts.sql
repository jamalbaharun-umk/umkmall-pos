CREATE TABLE "payment"."merchant_account_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"merchant_account_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"source" text NOT NULL,
	"actor_ref" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment"."merchant_account_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment"."merchant_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"status_reason" text,
	"provider_account_id" text,
	"credentials_encrypted" text,
	"business_type" text,
	"business_name" text,
	"email" text,
	"phone" text,
	"terms_accepted_at" timestamp with time zone,
	"draft_undelivered" boolean DEFAULT false NOT NULL,
	"enabled_methods" text[] DEFAULT '{}'::text[] NOT NULL,
	"submitted_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"status_observed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_accounts_status" CHECK ("payment"."merchant_accounts"."status" in ('not_submitted', 'submitted', 'needs_fix', 'rejected', 'verified', 'active', 'suspended')),
	CONSTRAINT "merchant_accounts_mode" CHECK ("payment"."merchant_accounts"."mode" in ('fake', 'sandbox', 'live'))
);
--> statement-breakpoint
ALTER TABLE "payment"."merchant_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment"."merchant_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"reference" text,
	"merchant_account_id" uuid,
	"state" text DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment"."merchant_webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment"."merchant_account_events" ADD CONSTRAINT "merchant_account_events_merchant_account_id_merchant_accounts_id_fk" FOREIGN KEY ("merchant_account_id") REFERENCES "payment"."merchant_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment"."merchant_webhook_events" ADD CONSTRAINT "merchant_webhook_events_merchant_account_id_merchant_accounts_id_fk" FOREIGN KEY ("merchant_account_id") REFERENCES "payment"."merchant_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "merchant_account_events_tenant_account" ON "payment"."merchant_account_events" USING btree ("tenant_id","merchant_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_accounts_tenant_provider" ON "payment"."merchant_accounts" USING btree ("tenant_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_accounts_provider_account" ON "payment"."merchant_accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "merchant_accounts_status_synced" ON "payment"."merchant_accounts" USING btree ("status","last_synced_at");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_webhook_events_provider_event" ON "payment"."merchant_webhook_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "merchant_webhook_events_state" ON "payment"."merchant_webhook_events" USING btree ("state","created_at");