-- A private note on each product, for the store owner and nobody else.
--
-- Written from the product's View panel in the store admin — a supplier's
-- name, a reorder reminder, why the price is what it is. Nothing on the
-- storefront reads it: every public product query names its columns one by
-- one, so a column added here cannot ride along into a shopper's response.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "owner_note" text;
