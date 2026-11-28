ALTER TABLE "pos"."products" ADD COLUMN "cost_set_at" timestamp with time zone;--> statement-breakpoint
-- UMK-2131: when a product's cost first went above 0, kept on every write path (catalog, import, purchases, agent)
-- by one trigger. Back to 0 clears it ("modal belum diisi" again). Existing products with a cost: their creation.
UPDATE "pos"."products" SET "cost_set_at" = "created_at" WHERE "cost_price" > 0;--> statement-breakpoint
CREATE FUNCTION "pos"."products_cost_set_at"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cost_price > 0 THEN
    NEW.cost_set_at := CASE WHEN TG_OP = 'UPDATE' AND OLD.cost_price > 0 THEN OLD.cost_set_at ELSE now() END;
  ELSE
    NEW.cost_set_at := NULL;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "products_cost_set_at" BEFORE INSERT OR UPDATE OF "cost_price" ON "pos"."products" FOR EACH ROW EXECUTE FUNCTION "pos"."products_cost_set_at"();
