-- A banner's category is its destination, not a placement restriction.
--
-- The column was declared `ON DELETE cascade`, which was harmless for as long
-- as nothing read it: a field no screen could set could not lose anything when
-- it went. Now that the banner editor picks a category as the banner's link,
-- cascade means tidying up the catalogue silently deletes artwork — the row,
-- both uploads and the schedule go with the category.
--
-- `set null` is the right failure. A banner with no destination is already a
-- state the storefront renders (`PromoBannerCard` draws it as an announcement
-- rather than a link), so the shop keeps the artwork and loses only the click.
ALTER TABLE "banners" DROP CONSTRAINT IF EXISTS "banners_category_id_categories_id_fk";--> statement-breakpoint
ALTER TABLE "banners" ADD CONSTRAINT "banners_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
