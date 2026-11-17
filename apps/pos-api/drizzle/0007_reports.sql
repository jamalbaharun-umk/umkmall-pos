CREATE TABLE "pos"."report_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'Asia/Jakarta' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pos"."report_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."report_settings" ADD CONSTRAINT "report_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;