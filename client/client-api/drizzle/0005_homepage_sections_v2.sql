-- ---------------------------------------------------------------------------
-- HAND-EDITED, for the same reason 0004 was: `drizzle-kit generate` would
-- rewrite migration 0000 and discard the CREATE TABLE IF NOT EXISTS edits that
-- keep a company-provisioned owner row alive.
--
-- Three more section kinds. Each covers something the storefront could not say
-- with the fifteen already there:
--
--   collection      a curated `collections` row shown as a block, which
--                   `product_grid` cannot express — a collection carries its own
--                   name, blurb and cover image, not just a list of ids.
--   social_gallery  the shop's own social photography. Not `lookbook`: a
--                   lookbook is editorial tiles the owner wrote copy for, this
--                   is a square feed that links out.
--   recently_viewed a per-visitor rail. It stores no ids at all — the browser
--                   holds the list — so it is a section type rather than a
--                   product block, and the only one whose contents the server
--                   never sees.
--
-- `ADD VALUE IF NOT EXISTS` is idempotent and is permitted inside the
-- transaction Drizzle's migrator opens, so long as the new value is not used in
-- that same transaction. Nothing below uses one.
-- ---------------------------------------------------------------------------
-- The queries these three unlock — the live flash-sale window, banners by
-- placement — are already indexed by `flash_sales_window_idx` and
-- `banners_position_idx` from 0001. Nothing to add here.
-- ---------------------------------------------------------------------------
ALTER TYPE "homepage_section_type" ADD VALUE IF NOT EXISTS 'collection';--> statement-breakpoint
ALTER TYPE "homepage_section_type" ADD VALUE IF NOT EXISTS 'social_gallery';--> statement-breakpoint
ALTER TYPE "homepage_section_type" ADD VALUE IF NOT EXISTS 'recently_viewed';
