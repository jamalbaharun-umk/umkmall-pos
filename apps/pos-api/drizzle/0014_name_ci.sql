ALTER TABLE "pos"."roles" DROP CONSTRAINT "roles_tenant_id_name_unique";--> statement-breakpoint
DROP INDEX "pos"."categories_tenant_name_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "roles_tenant_name_uq" ON "pos"."roles" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "staff_tenant_name_uq" ON "pos"."staff" USING btree ("tenant_id",lower("name")) WHERE "pos"."staff"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_tenant_name_uq" ON "pos"."categories" USING btree ("tenant_id",lower("name"));