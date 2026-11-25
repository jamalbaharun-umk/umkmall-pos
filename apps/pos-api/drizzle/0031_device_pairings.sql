CREATE TABLE "pos"."device_pairing_attempts" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pos"."device_pairing_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."device_pairings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"code_hash" text,
	"secret_hash" text NOT NULL,
	"requester_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"device_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pos"."device_pairings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."device_pairing_attempts" ADD CONSTRAINT "device_pairing_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."device_pairings" ADD CONSTRAINT "device_pairings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."device_pairings" ADD CONSTRAINT "device_pairings_tenant_id_device_id_devices_tenant_id_id_fk" FOREIGN KEY ("tenant_id","device_id") REFERENCES "pos"."devices"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_pairings_code_uq" ON "pos"."device_pairings" USING btree ("code_hash");