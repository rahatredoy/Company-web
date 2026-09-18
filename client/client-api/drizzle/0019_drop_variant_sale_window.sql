-- A sale price no longer has start and end dates.
--
-- The panel's Sale starts / Sale ends fields are gone, and a sale price now
-- applies from the moment it is saved until it is cleared. Nothing reads the
-- two columns any more.
ALTER TABLE "product_variants" DROP COLUMN IF EXISTS "sale_starts_at";
--> statement-breakpoint
ALTER TABLE "product_variants" DROP COLUMN IF EXISTS "sale_ends_at";
