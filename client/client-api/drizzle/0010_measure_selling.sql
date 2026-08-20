-- Selling by weight or volume: "৳40 Per 1kg (Min. 350gm)" with a 1kg/500gm/250gm
-- /100gm picker on the product card.
--
-- Deliberately additive, and deliberately *not* a change to any quantity column.
-- A measure product keeps one variant and one stock pool; what changes is only
-- how a quantity is read. `inventory_levels.available`, `order_items.quantity`
-- and the whole inventory ledger stay the integers they were — for a measure
-- product they count the small base unit (grams, millilitres, pieces), so the
-- `>= 0` CHECK constraints, returns, refunds and every report keep working
-- untouched. Widening them to numeric would have been the alternative, and it
-- would have put a rounding question into stock arithmetic that currently has
-- none.
--
-- Every column is nullable with an off-by-default switch, so an existing
-- catalogue reads exactly as it did: `sell_by = 'unit'` is the current behaviour
-- and is what every existing row gets.
DO $$ BEGIN
  CREATE TYPE "public"."product_sell_by" AS ENUM('unit', 'measure');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "sell_by" "product_sell_by" DEFAULT 'unit' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "measure_unit" varchar(8);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "pricing_measure" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "pricing_label" varchar(24);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "min_measure" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "measure_options" jsonb;--> statement-breakpoint

-- The measure a line bought, frozen beside the price and the name it was sold
-- under. Null means an ordinary product, which is how every existing line reads.
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "measure_label" varchar(24);--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "measure" integer;--> statement-breakpoint

-- A measure product is one variant priced at a rate; both of these are
-- nonsense without that, and a zero would divide.
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_measure_check";--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_measure_check" CHECK (
  "sell_by" = 'unit'
  OR ("measure_unit" IS NOT NULL AND "pricing_measure" IS NOT NULL AND "pricing_measure" > 0)
);--> statement-breakpoint

ALTER TABLE "order_items" DROP CONSTRAINT IF EXISTS "order_items_measure_check";--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_measure_check" CHECK (
  "measure" IS NULL OR "measure" > 0
);
