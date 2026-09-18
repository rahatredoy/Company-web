-- Discounts become rules rather than coupon codes.
--
-- Four things happen here, in an order that keeps every existing code working.
--
-- 1. The old `discounts` table goes. It was declared for "automatic discounts"
--    and nothing in the API ever read or wrote it, so it holds nothing — and
--    its name is the one the unified table needs.
--
-- 2. `coupons` is renamed to `discounts` and widened. A coupon code is now one
--    way of triggering a discount rather than the only kind there is: an
--    automatic discount has no code at all, a voucher has one that only its
--    owner may use, and a bank offer may have either. Every set-shaped rule
--    (which products, which customers, which payment) is a typed jsonb group
--    validated by `lib/discounts/rules.ts`; everything the list filters or the
--    checkout query narrows by stays a column.
--
--    Existing rows keep behaving exactly as they did: order-wide, no customer
--    or payment restriction, not combinable with anything. `scope`,
--    `target_ids` and `is_stackable` were never enforced, so they are dropped
--    rather than migrated — honouring them now would silently narrow codes that
--    shops have been handing out as order-wide.
--
-- 3. `coupon_redemptions` becomes `discount_redemptions`, gains the order's
--    totals either side of the discount and a `voided_at` so a cancelled order
--    hands its use back instead of counting against a limit for ever.
--
-- 4. Two new tables: `discount_customers` (a discount's named customers, and a
--    voucher's holders — each one usable once) and `payment_banks` (the
--    configurable bank list a card offer is matched against by card prefix).
DROP TABLE IF EXISTS "discounts";
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "discount_kind" AS ENUM ('coupon', 'automatic', 'voucher', 'campaign', 'bank_offer', 'payment_offer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "discount_value_type" AS ENUM ('percentage', 'fixed_amount', 'free_shipping', 'buy_x_get_y', 'fixed_price', 'bundle');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "discount_status" AS ENUM ('draft', 'active', 'paused');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "discount_assignment_source" AS ENUM ('manual', 'reward');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "coupons" RENAME TO "discounts";
--> statement-breakpoint
ALTER TABLE "discounts" RENAME CONSTRAINT "coupons_pkey" TO "discounts_pkey";
--> statement-breakpoint
ALTER TABLE "discounts" RENAME CONSTRAINT "coupons_used_check" TO "discounts_used_check";
--> statement-breakpoint
DROP INDEX IF EXISTS "coupons_code_key";
--> statement-breakpoint
DROP INDEX IF EXISTS "coupons_status_idx";
--> statement-breakpoint
ALTER TABLE "discounts" ALTER COLUMN "code" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "name" varchar(140);
--> statement-breakpoint
UPDATE "discounts" SET "name" = "code";
--> statement-breakpoint
ALTER TABLE "discounts" ALTER COLUMN "name" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "kind" "discount_kind" NOT NULL DEFAULT 'coupon';
--> statement-breakpoint
-- The old description was what the basket printed beside an applied code, which
-- is what the customer-facing title is now.
ALTER TABLE "discounts" RENAME COLUMN "description" TO "title";
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "summary" varchar(400);
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "notes" varchar(1000);
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "value_type" "discount_value_type";
--> statement-breakpoint
UPDATE "discounts" SET "value_type" = (CASE "type"::text
  WHEN 'fixed' THEN 'fixed_amount'
  WHEN 'free_shipping' THEN 'free_shipping'
  WHEN 'buy_x_get_y' THEN 'buy_x_get_y'
  ELSE 'percentage'
END)::"discount_value_type";
--> statement-breakpoint
ALTER TABLE "discounts" ALTER COLUMN "value_type" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "discounts" ALTER COLUMN "value_type" SET DEFAULT 'percentage';
--> statement-breakpoint
ALTER TABLE "discounts" DROP COLUMN "type";
--> statement-breakpoint
ALTER TABLE "discounts" ALTER COLUMN "value" SET DEFAULT '0';
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "min_quantity" integer;
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "max_discounted_quantity" integer;
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "min_subtotal_after_discount" numeric(12, 2);
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "product_rules" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "purchase_rules" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "reward_rules" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "customer_rules" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "payment_rules" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "area_rules" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "schedule_rules" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "combination_rules" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "issue_rules" jsonb;
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "cooldown_amount" integer;
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "cooldown_unit" varchar(8);
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "timezone" varchar(64);
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "priority" integer NOT NULL DEFAULT 10;
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "archived_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "discounts" ADD COLUMN "lifecycle" "discount_status";
--> statement-breakpoint
-- `scheduled` and `expired` were stored states; they are read off the clock now.
-- An `expired` row with no end date has nothing on the clock to say so, so it is
-- paused rather than silently revived.
UPDATE "discounts" SET "lifecycle" = (CASE "status"::text
  WHEN 'disabled' THEN 'paused'
  WHEN 'expired' THEN (CASE WHEN "ends_at" IS NULL THEN 'paused' ELSE 'active' END)
  ELSE 'active'
END)::"discount_status";
--> statement-breakpoint
ALTER TABLE "discounts" DROP COLUMN "status";
--> statement-breakpoint
ALTER TABLE "discounts" RENAME COLUMN "lifecycle" TO "status";
--> statement-breakpoint
ALTER TABLE "discounts" ALTER COLUMN "status" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "discounts" ALTER COLUMN "status" SET DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE "discounts" DROP COLUMN "scope";
--> statement-breakpoint
ALTER TABLE "discounts" DROP COLUMN "target_ids";
--> statement-breakpoint
ALTER TABLE "discounts" DROP COLUMN "is_stackable";
--> statement-breakpoint
DROP TYPE IF EXISTS "coupon_status";
--> statement-breakpoint
DROP TYPE IF EXISTS "discount_scope";
--> statement-breakpoint
DROP TYPE IF EXISTS "discount_type";
--> statement-breakpoint
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_code_by_kind_check" CHECK (
  ("kind" IN ('coupon', 'voucher') AND "code" IS NOT NULL)
  OR ("kind" IN ('automatic', 'campaign') AND "code" IS NULL)
  OR "kind" IN ('bank_offer', 'payment_offer')
);
--> statement-breakpoint
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_value_check" CHECK ("value" >= 0);
--> statement-breakpoint
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_cooldown_check" CHECK (
  ("cooldown_amount" IS NULL AND "cooldown_unit" IS NULL)
  OR ("cooldown_amount" >= 1 AND "cooldown_unit" IN ('day', 'week', 'month'))
);
--> statement-breakpoint
-- Codes are matched case-insensitively at the till, so uniqueness is too.
CREATE UNIQUE INDEX IF NOT EXISTS "discounts_code_key" ON "discounts" (upper("code")) WHERE "code" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discounts_status_idx" ON "discounts" ("status", "starts_at", "ends_at") WHERE "archived_at" IS NULL;
--> statement-breakpoint
-- What every checkout asks: which code-less discounts are switched on right now.
CREATE INDEX IF NOT EXISTS "discounts_automatic_idx" ON "discounts" ("priority") WHERE "code" IS NULL AND "status" = 'active' AND "archived_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discounts_created_idx" ON "discounts" ("created_at", "id");
--> statement-breakpoint
ALTER TABLE "coupon_redemptions" RENAME TO "discount_redemptions";
--> statement-breakpoint
ALTER TABLE "discount_redemptions" RENAME COLUMN "coupon_id" TO "discount_id";
--> statement-breakpoint
ALTER TABLE "discount_redemptions" RENAME CONSTRAINT "coupon_redemptions_pkey" TO "discount_redemptions_pkey";
--> statement-breakpoint
ALTER TABLE "discount_redemptions" RENAME CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" TO "discount_redemptions_discount_id_discounts_id_fk";
--> statement-breakpoint
ALTER TABLE "discount_redemptions" RENAME CONSTRAINT "coupon_redemptions_customer_id_customers_id_fk" TO "discount_redemptions_customer_id_customers_id_fk";
--> statement-breakpoint
ALTER TABLE "discount_redemptions" RENAME CONSTRAINT "coupon_redemptions_order_id_orders_id_fk" TO "discount_redemptions_order_id_orders_id_fk";
--> statement-breakpoint
ALTER INDEX IF EXISTS "coupon_redemptions_order_key" RENAME TO "discount_redemptions_order_key";
--> statement-breakpoint
ALTER INDEX IF EXISTS "coupon_redemptions_customer_idx" RENAME TO "discount_redemptions_customer_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "coupon_redemptions_email_idx" RENAME TO "discount_redemptions_email_idx";
--> statement-breakpoint
ALTER TABLE "discount_redemptions" ADD COLUMN "code" varchar(40);
--> statement-breakpoint
ALTER TABLE "discount_redemptions" ADD COLUMN "shipping_discount" numeric(12, 2) NOT NULL DEFAULT '0';
--> statement-breakpoint
ALTER TABLE "discount_redemptions" ADD COLUMN "original_amount" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "discount_redemptions" ADD COLUMN "final_amount" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "discount_redemptions" ADD COLUMN "assignment_id" uuid;
--> statement-breakpoint
ALTER TABLE "discount_redemptions" ADD COLUMN "voided_at" timestamptz;
--> statement-breakpoint
UPDATE "discount_redemptions" r SET "code" = d."code" FROM "discounts" d WHERE d."id" = r."discount_id";
--> statement-breakpoint
UPDATE "discount_redemptions" r
   SET "original_amount" = o."subtotal" + o."shipping_total",
       "final_amount" = o."grand_total"
  FROM "orders" o
 WHERE o."id" = r."order_id";
--> statement-breakpoint
-- The index every limit and cooldown check reads: live uses of one discount.
CREATE INDEX IF NOT EXISTS "discount_redemptions_live_idx" ON "discount_redemptions" ("discount_id", "created_at") WHERE "voided_at" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discount_customers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "discount_id" uuid NOT NULL REFERENCES "discounts"("id") ON DELETE CASCADE,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "source" "discount_assignment_source" NOT NULL DEFAULT 'manual',
  "period_key" varchar(16) NOT NULL DEFAULT '',
  "issued_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz,
  "used_at" timestamptz,
  "order_id" uuid REFERENCES "orders"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "discount_customers_period_key" ON "discount_customers" ("discount_id", "customer_id", "period_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discount_customers_customer_idx" ON "discount_customers" ("customer_id", "used_at");
--> statement-breakpoint
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_assignment_id_fk"
  FOREIGN KEY ("assignment_id") REFERENCES "discount_customers"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_banks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(120) NOT NULL,
  "short_name" varchar(40),
  "country" varchar(2) NOT NULL DEFAULT 'BD',
  "card_prefixes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_banks_name_key" ON "payment_banks" (lower("name"));
--> statement-breakpoint
-- Names only. A bank's card prefixes are the shop's to enter from what its
-- bank partnership actually covers; a guessed prefix would hand the offer to
-- the wrong cardholders, so none are invented here.
INSERT INTO "payment_banks" ("name", "short_name", "sort_order") VALUES
  ('Islami Bank Bangladesh', 'IBBL', 10),
  ('BRAC Bank', 'BRAC', 20),
  ('City Bank', 'City', 30),
  ('Eastern Bank', 'EBL', 40),
  ('Dutch-Bangla Bank', 'DBBL', 50),
  ('Standard Chartered', 'SCB', 60),
  ('HSBC', 'HSBC', 70),
  ('Prime Bank', 'Prime', 80),
  ('Mutual Trust Bank', 'MTB', 90),
  ('United Commercial Bank', 'UCB', 100),
  ('Bank Asia', 'Bank Asia', 110),
  ('Southeast Bank', 'SEBL', 120)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "coupon_code" TYPE varchar(200);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_channel" varchar(24);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "card_bin" varchar(8);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "birth_date" date;
