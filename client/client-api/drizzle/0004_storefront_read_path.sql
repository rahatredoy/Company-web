-- ---------------------------------------------------------------------------
-- HAND-EDITED: none of this is derived from the Drizzle schema.
--
-- The storefront renders fifteen kinds of homepage section; `homepage_section_type`
-- could store seven. The eight missing values are added here rather than by
-- regenerating, because `drizzle-kit generate` would rewrite migration 0000 and
-- discard the CREATE TABLE IF NOT EXISTS edits that keep a company-provisioned
-- owner row alive.
--
-- `ADD VALUE IF NOT EXISTS` is idempotent, and PostgreSQL 12+ permits it inside
-- the transaction Drizzle's migrator opens so long as the new value is not used
-- in that same transaction. Nothing below uses one.
-- ---------------------------------------------------------------------------
ALTER TYPE "homepage_section_type" ADD VALUE IF NOT EXISTS 'category_circle';--> statement-breakpoint
ALTER TYPE "homepage_section_type" ADD VALUE IF NOT EXISTS 'product_carousel';--> statement-breakpoint
ALTER TYPE "homepage_section_type" ADD VALUE IF NOT EXISTS 'deal';--> statement-breakpoint
ALTER TYPE "homepage_section_type" ADD VALUE IF NOT EXISTS 'promo_trio';--> statement-breakpoint
ALTER TYPE "homepage_section_type" ADD VALUE IF NOT EXISTS 'flash_sale';--> statement-breakpoint
ALTER TYPE "homepage_section_type" ADD VALUE IF NOT EXISTS 'benefits';--> statement-breakpoint
ALTER TYPE "homepage_section_type" ADD VALUE IF NOT EXISTS 'lookbook';--> statement-breakpoint
ALTER TYPE "homepage_section_type" ADD VALUE IF NOT EXISTS 'testimonial';--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Reviews are read by product and rating on every product page. The existing
-- index leads with `status` after `product_id`, which serves the listing; this
-- one serves the rating histogram without a second pass over the table.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "reviews_product_rating_idx" ON "reviews" ("product_id", "status", "rating");--> statement-breakpoint
-- Storefront listings always filter on published-and-active. Without this the
-- default sort falls back to a full scan on every category page.
CREATE INDEX IF NOT EXISTS "products_storefront_idx" ON "products" ("status", "created_at");
