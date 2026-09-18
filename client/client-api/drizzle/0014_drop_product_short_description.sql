-- A product is described once.
--
-- `short_description` is dropped. The panel no longer asks for it, the
-- storefront no longer prints it, and a product page is described to search
-- engines by its own `seo_description`, falling back to the opening of the full
-- `description`. The trigram index 0006 built for the listing's `?q=` goes
-- with it; search matches the name.
DROP INDEX IF EXISTS "products_short_desc_trgm_idx";
--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN IF EXISTS "short_description";
