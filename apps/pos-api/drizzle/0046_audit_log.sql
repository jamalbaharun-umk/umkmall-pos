CREATE TABLE "pos"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "pos"."audit_log_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"target_label" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pos"."audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "pos"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_tenant_time_idx" ON "pos"."audit_log" USING btree ("tenant_id","occurred_at" DESC NULLS LAST,"seq" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_tenant_actor_idx" ON "pos"."audit_log" USING btree ("tenant_id","actor_id");--> statement-breakpoint
-- Append only (UMK-1969): a row is never changed. DELETE stays possible for the erasure purge only (no route
-- deletes; test/audit.e2e-spec.ts).
CREATE FUNCTION "pos"."audit_log_no_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'pos.audit_log is append only';
END
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_log_no_update" BEFORE UPDATE ON "pos"."audit_log" FOR EACH ROW EXECUTE FUNCTION "pos"."audit_log_no_update"();
