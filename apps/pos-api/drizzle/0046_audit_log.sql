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
-- Append only (UMK-1969): a row is never changed, and is deleted only by the erasure purge, which sets
-- `pos.purging` to the tenant it is erasing inside its transaction (src/purge/purge.service.ts). TRUNCATE is
-- never allowed. This guards against a bug or a stray statement of the application; the table's owner role could
-- still drop the trigger, as with any trigger.
CREATE FUNCTION "pos"."audit_log_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' AND OLD.tenant_id::text = current_setting('pos.purging', true) THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'pos.audit_log is append only';
END
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_log_no_update" BEFORE UPDATE OR DELETE ON "pos"."audit_log" FOR EACH ROW EXECUTE FUNCTION "pos"."audit_log_guard"();--> statement-breakpoint
CREATE TRIGGER "audit_log_no_truncate" BEFORE TRUNCATE ON "pos"."audit_log" FOR EACH STATEMENT EXECUTE FUNCTION "pos"."audit_log_guard"();
