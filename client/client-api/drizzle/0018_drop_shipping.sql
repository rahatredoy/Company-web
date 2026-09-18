-- Shipping and delivery charges are gone from the platform.
--
-- What is removed: shipping zones and methods, the delivery charge on an order,
-- the separate delivery status (and its enum), shipment tracking, the
-- free-delivery discount type and the part of a redemption that was delivery.
--
-- What stays: the order status itself (`shipped`, `out_for_delivery`,
-- `delivered`, and the `shipped_at` / `delivered_at` stamps), every delivery
-- address (`order_addresses`, `customer_addresses`, `address_type`), cash on
-- delivery, and the owner's shipping-policy page and FAQ copy.
--
-- Every statement is guarded, so a tenant that is part-way through — or was
-- provisioned after this shape — migrates cleanly.

-- 1. Free-delivery discounts. They can give nothing now, so they are deleted
--    rather than left to apply for nothing. Their redemptions and customer
--    holdings go with them (both are ON DELETE CASCADE); the orders they were
--    used on keep their totals, which never included a delivery discount in
--    `discount_total`. `orders.coupon_id` carries no foreign key, so it is
--    cleared by hand rather than left naming a row that no longer exists.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'discount_value_type' AND e.enumlabel = 'free_shipping'
  ) THEN
    UPDATE "orders" SET "coupon_id" = NULL
     WHERE "coupon_id" IN (SELECT "id" FROM "discounts" WHERE "value_type"::text = 'free_shipping');
    DELETE FROM "discounts" WHERE "value_type"::text = 'free_shipping';
  END IF;
END $$;
--> statement-breakpoint
-- A discount that allowed combining with the free-delivery class keeps every
-- other class it named. Left in, the stored rule would fail to parse and fall
-- back to "combines with nothing".
UPDATE "discounts"
   SET "combination_rules" = jsonb_set(
         "combination_rules",
         '{with}',
         COALESCE(
           (SELECT jsonb_agg(entry) FROM jsonb_array_elements("combination_rules"->'with') AS entry
             WHERE entry <> '"free_shipping"'::jsonb),
           '[]'::jsonb
         )
       )
 WHERE jsonb_typeof("combination_rules"->'with') = 'array'
   AND "combination_rules"->'with' ? 'free_shipping';
--> statement-breakpoint
-- 2. `discount_value_type` without 'free_shipping'. Postgres cannot drop an
--    enum label, so the type is rebuilt: rename the old one, create the new,
--    move the column across by text, drop the old.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'discount_value_type' AND e.enumlabel = 'free_shipping'
  ) THEN
    ALTER TYPE "discount_value_type" RENAME TO "discount_value_type_old";
    CREATE TYPE "discount_value_type" AS ENUM ('percentage', 'fixed_amount', 'buy_x_get_y', 'fixed_price', 'bundle');
    ALTER TABLE "discounts" ALTER COLUMN "value_type" DROP DEFAULT;
    ALTER TABLE "discounts"
      ALTER COLUMN "value_type" TYPE "discount_value_type" USING "value_type"::text::"discount_value_type";
    ALTER TABLE "discounts" ALTER COLUMN "value_type" SET DEFAULT 'percentage';
    DROP TYPE "discount_value_type_old";
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "discount_redemptions" DROP COLUMN IF EXISTS "shipping_discount";
--> statement-breakpoint
-- 3. Tracking.
DROP TABLE IF EXISTS "shipments";
--> statement-breakpoint
-- 4. Zones and methods. Methods first: they reference zones.
DROP TABLE IF EXISTS "shipping_methods";
--> statement-breakpoint
DROP TABLE IF EXISTS "shipping_zones";
--> statement-breakpoint
-- 5. The delivery charge and the separate delivery status on an order.
ALTER TABLE "orders" DROP COLUMN IF EXISTS "shipping_status";
--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "shipping_total";
--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "shipping_method_id";
--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "shipping_method_label";
--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "estimated_delivery_at";
--> statement-breakpoint
-- Nothing ever wrote this aggregate, and there is no delivery charge left to sum.
ALTER TABLE "store_daily_metrics" DROP COLUMN IF EXISTS "shipping";
--> statement-breakpoint
-- Only `orders.shipping_status` and `shipments.status` used it, and both are gone.
DROP TYPE IF EXISTS "shipping_status";
