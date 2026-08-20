-- ---------------------------------------------------------------------------
-- HAND-EDITED, for the same reason 0004, 0005 and 0006 were: `drizzle-kit
-- generate` would rewrite migration 0000 and discard the CREATE TABLE IF NOT
-- EXISTS edits that keep a company-provisioned owner row alive. Add a
-- migration, never regenerate.
--
-- A category can now be *featured*, the same way a product already can be. The
-- panel's category screen surfaces it as its own count and its own badge, and
-- the storefront's navigation uses it to decide what leads the menu — which is
-- a different question from `show_in_menu` (may it appear at all) and from
-- `is_active` (may a shopper see it at all).
--
-- Defaulted to false rather than nullable: every read treats it as a plain
-- boolean, and a three-valued column would put a `coalesce` in the middle of
-- the navigation query for no gain.
--
-- `IF NOT EXISTS` throughout: this runs against every tenant database,
-- some of which were pre-warmed by hand.
-- ---------------------------------------------------------------------------

ALTER TABLE "categories"
  ADD COLUMN IF NOT EXISTS "is_featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- The featured set is a small slice of an already small table, so the index is
-- partial: it holds only the rows the navigation actually asks for, ordered the
-- way it asks for them.
CREATE INDEX IF NOT EXISTS "categories_featured_idx"
  ON "categories" ("sort_order", "name")
  WHERE "is_featured" = true AND "is_active" = true;
