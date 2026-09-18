-- A brand is a name, an address, a description and a logo.
--
-- `website_url`, `sort_order`, `seo_title` and `seo_description` are dropped.
-- The panel no longer asks for any of them: brands are listed by name rather
-- than by a hand-kept order, and a brand page is described to search engines by
-- its own name and description.
DROP INDEX IF EXISTS "brands_active_idx";
--> statement-breakpoint
ALTER TABLE "brands" DROP COLUMN IF EXISTS "website_url";
--> statement-breakpoint
ALTER TABLE "brands" DROP COLUMN IF EXISTS "sort_order";
--> statement-breakpoint
ALTER TABLE "brands" DROP COLUMN IF EXISTS "seo_title";
--> statement-breakpoint
ALTER TABLE "brands" DROP COLUMN IF EXISTS "seo_description";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brands_active_idx" ON "brands" ("is_active", "name");
