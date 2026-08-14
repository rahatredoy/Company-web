-- ---------------------------------------------------------------------------
-- HAND-EDITED, for the same reason 0004 and 0005 were: `drizzle-kit generate`
-- would rewrite migration 0000 and discard the CREATE TABLE IF NOT EXISTS edits
-- that keep a company-provisioned owner row alive. Add a migration, never
-- regenerate.
--
-- Everything here serves the **public storefront read path** — the queries that
-- run once per shopper per page rather than once per admin per save. The panel's
-- own indexes are already in 0001 and are not touched.
--
-- Two shapes of index, for two different problems.
--
-- 1. PARTIAL indexes on `status = 'active'`. Every storefront listing carries
--    that predicate (`PUBLISHED_PRODUCT`), and a store's catalogue is mostly
--    drafts and archived rows on the day it launches. A partial index holds only
--    the rows the storefront can see, so it is a fraction of the size, stays in
--    memory, and — crucially — lets PostgreSQL satisfy `ORDER BY … LIMIT 24`
--    from the index alone instead of sorting the whole matching set. That is the
--    difference between a category page that is O(log n) and one that degrades
--    as the shop grows.
--
-- 2. TRIGRAM indexes for `ILIKE '%term%'`. A leading wildcard cannot use a
--    B-tree at all — the search box and every `?q=` listing were sequential
--    scans of `products`, on the one query a shopper fires per keystroke.
--
-- `IF NOT EXISTS` throughout: `db/tenant-migrate.ts` runs this against every
-- tenant database, some of which were pre-warmed by hand.
--
-- CONCURRENTLY is deliberately NOT used. It cannot run inside the transaction
-- Drizzle's migrator opens, and these run per tenant on first request after a
-- deploy against a catalogue of thousands of rows, not billions — the lock is
-- measured in milliseconds. A shard holding a genuinely large store should have
-- this applied out-of-band first (`npm run db:migrate:tenants -- --slug …`).
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------- search ----
-- pg_trgm ships with PostgreSQL as a contrib module. The tenant role owns its
-- own database, so it may create this; a managed provider that forbids it will
-- fail loudly here rather than silently keeping the sequential scans.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

-- `ilike(products.name, '%term%')` — the search box and `/search?q=`.
CREATE INDEX IF NOT EXISTS "products_name_trgm_idx"
  ON "products" USING gin ("name" gin_trgm_ops);--> statement-breakpoint

-- The listing's `?q=` also matches the short description.
CREATE INDEX IF NOT EXISTS "products_short_desc_trgm_idx"
  ON "products" USING gin ("short_description" gin_trgm_ops);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "categories_name_trgm_idx"
  ON "categories" USING gin ("name" gin_trgm_ops);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "brands_name_trgm_idx"
  ON "brands" USING gin ("name" gin_trgm_ops);--> statement-breakpoint

-- ------------------------------------------------------- listing sorts ----
-- One partial index per sort the storefront offers, because `orderFor()` in
-- `modules/storefront/service.ts` is a closed set of six and each one is a
-- different leading column. Without these, "Newest" on a 50,000-product shop
-- reads every active row and sorts it to return twenty-four.

-- `relevance`, the default: featured first, then what sells.
CREATE INDEX IF NOT EXISTS "products_active_relevance_idx"
  ON "products" ("is_featured" DESC, "sold_count" DESC, "created_at" DESC)
  WHERE "status" = 'active';--> statement-breakpoint

-- `best_selling`, and the `best_selling` homepage source.
CREATE INDEX IF NOT EXISTS "products_active_sold_idx"
  ON "products" ("sold_count" DESC)
  WHERE "status" = 'active';--> statement-breakpoint

-- `newest`, and the `new_arrivals` homepage source. Expression index because the
-- sort is `coalesce(published_at, created_at)` — a plain column index on either
-- one cannot serve it.
CREATE INDEX IF NOT EXISTS "products_active_published_idx"
  ON "products" ((coalesce("published_at", "created_at")) DESC)
  WHERE "status" = 'active';--> statement-breakpoint

-- `price_asc` / `price_desc`, and the min/max price facet. Expression index on
-- the *effective* price — what the customer actually pays — because that is what
-- `effectivePriceSql` sorts and filters on, and an index on `price_from` alone
-- would be ignored the moment anything went on sale.
CREATE INDEX IF NOT EXISTS "products_active_effective_price_idx"
  ON "products" ((coalesce("sale_price_from", "price_from", 0)))
  WHERE "status" = 'active';--> statement-breakpoint

-- `rating`, and the rating facet's three cumulative counts.
CREATE INDEX IF NOT EXISTS "products_active_rating_idx"
  ON "products" ("rating_average" DESC, "rating_count" DESC)
  WHERE "status" = 'active';--> statement-breakpoint

-- ----------------------------------------------------- listing filters ----
-- A category page is `category_id IN (subtree)` and then one of the sorts above.
-- Leading with the filter column is what lets the index answer the WHERE; the
-- sort columns ride along so the top-N comes back without a second pass.
CREATE INDEX IF NOT EXISTS "products_active_category_idx"
  ON "products" ("category_id", "is_featured" DESC, "sold_count" DESC)
  WHERE "status" = 'active';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "products_active_brand_idx"
  ON "products" ("brand_id", "is_featured" DESC, "sold_count" DESC)
  WHERE "status" = 'active';--> statement-breakpoint

-- The `/sale` listing and the `sale` homepage source: on sale *and* actually
-- discounted. Doubly partial — the rows that are neither are the majority of a
-- catalogue and have no business in this index.
CREATE INDEX IF NOT EXISTS "products_active_sale_idx"
  ON "products" ("sale_price_from")
  WHERE "status" = 'active' AND "sale_price_from" IS NOT NULL;--> statement-breakpoint

-- The `featured` homepage source, which is a bare equality on a boolean and so
-- wants only the rows that are true.
CREATE INDEX IF NOT EXISTS "products_active_featured_idx"
  ON "products" ("sold_count" DESC)
  WHERE "status" = 'active' AND "is_featured" = true;--> statement-breakpoint

-- ------------------------------------------------------- decoration ----
-- `decorateSummaries` fetches images for a whole page of products in one read,
-- filtered to `type = 'image'` and ordered primary-first. The existing
-- `product_media_product_idx` leads with the right column but carries video rows
-- and does not hold the ordering, so every listing sorted its own images.
CREATE INDEX IF NOT EXISTS "product_media_image_idx"
  ON "product_media" ("product_id", "is_primary" DESC, "sort_order")
  WHERE "type" = 'image';--> statement-breakpoint

-- The same read's key-spec lookup. Key specs are a handful of rows per product
-- out of a spec sheet that can run to dozens.
CREATE INDEX IF NOT EXISTS "product_specifications_key_idx"
  ON "product_specifications" ("product_id", "sort_order")
  WHERE "is_key_spec" = true;--> statement-breakpoint

-- The stock roll-up in `decorateSummaries` and in `inStockSql`, both of which
-- join variants to levels and discard inactive variants. `product_variants_product_idx`
-- exists but includes inactive rows.
CREATE INDEX IF NOT EXISTS "product_variants_active_idx"
  ON "product_variants" ("product_id", "sort_order")
  WHERE "is_active" = true;--> statement-breakpoint

-- ------------------------------------------------------------ facets ----
-- The attribute facet joins products → product_attribute_values → values →
-- attributes and groups the lot. The primary key on
-- (product_id, attribute_value_id) serves the first join; this serves the walk
-- back the other way, which the value-led plan uses on a filtered listing.
CREATE INDEX IF NOT EXISTS "product_attribute_values_product_idx"
  ON "product_attribute_values" ("product_id");--> statement-breakpoint

-- `attributeCondition` filters attribute values by their attribute's slug.
CREATE INDEX IF NOT EXISTS "attributes_filterable_idx"
  ON "attributes" ("slug")
  WHERE "is_filterable" = true;
