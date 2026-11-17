CREATE TABLE "pos"."store_profiles" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"business_type" text NOT NULL,
	"other_business_type" text,
	"address" text NOT NULL,
	"logo_key" text,
	"logo_content_type" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_profiles_business_type_ck" CHECK ("pos"."store_profiles"."business_type" in ('retail', 'wholesale', 'fnb', 'fashion', 'pharmacy', 'other'))
);
--> statement-breakpoint
ALTER TABLE "pos"."store_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."store_profiles" ADD CONSTRAINT "store_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;