-- ---------------------------------------------------------------------------
-- HAND-EDITED, for the same reason 0004 through 0007 were: `drizzle-kit
-- generate` would rewrite migration 0000 and discard the CREATE TABLE IF NOT
-- EXISTS edits that keep a company-provisioned owner row alive. Add a
-- migration, never regenerate.
--
-- Two columns the product screens now need.
--
-- `video_url` is one optional clip, kept beside the gallery rather than inside
-- it. `product_media` can already store a `video` row, but the gallery is
-- written back as a whole list of images and reordered as one — a video mixed
-- into it would be dragged about as though it were a thumbnail, and silently
-- deleted by any client that sends only images back. A product has at most one
-- clip, so it is a column rather than a row.
--
-- `track_inventory` is whether stock is allowed to refuse a sale. Off does not
-- mean "no stock rows": an untracked product can still hold a count worth
-- reading on the product screen, and a tracked product with no rows yet is
-- merely unmeasured. Both read as sellable, for different reasons, and the
-- storefront listing, the product page and checkout all honour both. Defaulted
-- true and NOT NULL, because that is what every existing product already is,
-- and a three-valued column would put a `coalesce` in the middle of the
-- listing's in-stock predicate for no gain.
--
-- `IF NOT EXISTS` throughout: this runs against every tenant database, some of
-- which were pre-warmed by hand.
-- ---------------------------------------------------------------------------

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "video_url" text;--> statement-breakpoint

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "track_inventory" boolean DEFAULT true NOT NULL;
