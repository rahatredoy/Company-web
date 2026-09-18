-- A category is a name, an address and one picture.
--
-- `description`, `icon_url` and `banner_url` are dropped. The panel no longer
-- asks for any of them, and a column nothing writes is one the next reader has
-- to find out is dead: the storefront's rail falls back to the glyph chosen on
-- the Design screen (`header_configuration.categoryIcons`), and a category page
-- is described to search engines by its own `seo_description`.
ALTER TABLE "categories" DROP COLUMN IF EXISTS "description";
--> statement-breakpoint
ALTER TABLE "categories" DROP COLUMN IF EXISTS "icon_url";
--> statement-breakpoint
ALTER TABLE "categories" DROP COLUMN IF EXISTS "banner_url";
