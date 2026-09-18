-- The newsletter is removed.
--
-- The panel's Newsletter screen, its admin endpoints, the storefront sign-up
-- band and `POST /storefront/newsletter` are gone, so the list they wrote has no
-- reader and no writer. Nothing was ever sent from it.
DROP TABLE IF EXISTS "newsletter_subscribers";
--> statement-breakpoint
DROP TYPE IF EXISTS "subscriber_status";
--> statement-breakpoint
-- The homepage block that rendered the sign-up form goes with it. Postgres cannot
-- drop one value from an enum, so the type is rebuilt without it once no row
-- holds that value.
DELETE FROM "homepage_sections" WHERE "type"::text = 'newsletter';
--> statement-breakpoint
ALTER TYPE "homepage_section_type" RENAME TO "homepage_section_type_old";
--> statement-breakpoint
CREATE TYPE "homepage_section_type" AS ENUM('hero', 'category_grid', 'category_circle', 'product_grid', 'product_carousel', 'banner', 'deal', 'promo_trio', 'flash_sale', 'benefits', 'lookbook', 'testimonial', 'brands', 'text', 'collection', 'social_gallery', 'recently_viewed');
--> statement-breakpoint
ALTER TABLE "homepage_sections" ALTER COLUMN "type" TYPE "homepage_section_type" USING "type"::text::"homepage_section_type";
--> statement-breakpoint
DROP TYPE "homepage_section_type_old";
