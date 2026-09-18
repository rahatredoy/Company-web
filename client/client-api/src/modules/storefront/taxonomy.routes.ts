import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { brands, categories, products } from '../../db/schema/index';
import { CACHE_TTL, cached, tenantKey } from '../../lib/cache';
import { notFound } from '../../lib/errors';
import { ok, parseParams, parseQuery } from '../../lib/http';
import { queryKey } from '../../lib/public-cache';
import { storeOf } from '../../plugins/tenant';
import type { TenantDb } from '../../db/tenant-manager';
import {
  breadcrumbFor,
  descendantIds,
  loadCategoryTree,
  PUBLISHED_PRODUCT,
  rotateWindow,
  rotationIndex,
} from './service';
import type { BrandView, CategoryShowcaseGroup, CategoryView } from './types';

const slugParamSchema = z.object({ slug: z.string().trim().min(1).max(220) });

/**
 * The showcase's bounds, and every one of them is a bound on the *query* rather
 * than on the answer: the mapping below is one `values` row per category, so a
 * caller asking for twelve departments of twenty-four aisles is what decides how
 * much work Postgres does. They are capped here so that no caller can.
 */
const showcaseQuerySchema = z.object({
  /**
   * Which categories to draw, when the block names them.
   *
   * Any level: a section pointed at one department gets its aisles, exactly as a
   * section pointed at the whole shop gets each department's. Without it the
   * store's own top-level order is used, capped by `categories` — an id list is
   * the owner's arrangement and must not be silently re-ordered, so it is
   * honoured in the order it arrives.
   */
  ids: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      const parts = (Array.isArray(value) ? value : value.split(','))
        .map((part) => part.trim())
        .filter((part) => z.string().uuid().safeParse(part).success)
        .slice(0, 12);
      return parts.length > 0 ? parts : undefined;
    }),
  /**
   * Where in the store's own order to start.
   *
   * This is what lets a homepage carry **one block per department, spread
   * between its other sections** rather than six panels stacked in one place —
   * a block asks for one department at an offset, and the offsets are what keep
   * two blocks from drawing the same one. It has to be an offset rather than an
   * id, because a newly provisioned store is seeded with these blocks on the day
   * it has no categories at all: an id would have to be filled in later by hand,
   * an offset fills itself in as the owner builds the shop.
   */
  offset: z.coerce.number().int().min(0).max(11).default(0),
  categories: z.coerce.number().int().min(1).max(12).default(6),
  rows: z.coerce.number().int().min(1).max(8).default(3),
  perRow: z.coerce.number().int().min(1).max(24).default(12),
});

/**
 * How many aisles of one department are considered.
 *
 * More than the rows a panel draws, on purpose: empty aisles are dropped after
 * the ranking, so the candidates have to outnumber the rows or a department
 * whose first few aisles are bare would come back with nothing.
 *
 * It is also the length of the rotation's lap, which is the reason it is this
 * generous. A department with more than twenty-four aisles previews the first
 * twenty-four and rotates within them; the rest are still **reachable** — the
 * panel header lists every aisle that has products as a chip, and the
 * department's own page lists all of them — they are simply never the row on
 * the homepage. A shop arranged that finely is better served by a block per
 * department than by a deeper cap here, since the cost of raising it is paid on
 * every render by every store.
 */
export const MAX_AISLES = 24;

/** Raw-SQL rows come back untyped; this is the shape the handler reads. */
interface ShowcaseRankRow extends Record<string, unknown> {
  bucketId: string;
  productId: string;
}

/** The parsed shape of a showcase request, as the resolver below reads it. */
export type ShowcaseQuery = z.output<typeof showcaseQuerySchema>;

/**
 * The showcase's answer, for one turn of the clock.
 *
 * Lifted out of the route handler and exported for the reason `resolveSource` is:
 * `scripts/verify-home-rotation.ts` walks a **whole lap** of the rotation and
 * asserts that it covers every aisle and every product rather than sampling
 * them. There is no way to check that through HTTP — a caller cannot move the
 * clock, and a lap is the better part of a day.
 *
 * `rotation` moves two windows, and both of them for the same reason. A
 * department with nine aisles previewed three at a time used to show the first
 * three and no others, so six aisles of the shop could not be reached from the
 * homepage at all; an aisle showing eight of its thirty products used to show the
 * same eight. Neither is a claim the panel makes — the heading over a row is an
 * aisle's *name*, and every product filed under it is equally entitled to be
 * there — so both windows walk their whole set. This is the distinction
 * `ROTATION_POOL` records for the homepage's sources: a predicate rotates freely,
 * a superlative does not rotate past the point where it stops being true.
 */
export async function resolveShowcase(
  store: { tenantRef: string; db: TenantDb },
  query: ShowcaseQuery,
  rotation: number,
): Promise<CategoryShowcaseGroup[]> {
  const tree = await loadCategoryTree(store);

  /*
   * A named id that no longer exists — or was deactivated since the block
   * was saved — is dropped rather than answered with the whole shop: a
   * section pointed at one department must never widen into every other
   * one because somebody hid it.
   */
  const byId = new Map(tree.map((node) => [node.id, node]));
  const departments = query.ids
    ? query.ids.map((id) => byId.get(id)).filter((node) => node !== undefined)
    : tree
        .filter((node) => node.parentId === null)
        .slice(query.offset, query.offset + query.categories);

  if (departments.length === 0) return [];

  /*
   * One bucket per row the panel could draw.
   *
   * A row is headed by an aisle and counts everything beneath it, because
   * a shop that nests three deep still has its products on the leaves —
   * `descendantIds` is the same subtree the aisle's own page would list,
   * so the row cannot show fewer products than the link under it opens.
   *
   * A department with no aisles is its own single row: a flat catalogue is
   * a shape this block has to render, not one it may skip. A department
   * that has aisles gets one too, on its **direct** products only and
   * marked `fallback` — used when not one of its aisles has anything in
   * it, which is otherwise a department that disappears from the homepage
   * while its own products sit there unlisted. The pairs have to stay
   * unique: the same category on two rows of the `values` list would join
   * its products twice and number them twice inside one partition.
   *
   * **A bucket carries its own product clock, and it has to be its own.** The
   * two windows would otherwise resonate: an aisle that comes round every three
   * hours, in a department whose aisles hold twenty-four products shown eight at
   * a time, would meet a product window that had advanced by exactly
   * 3 × 8 = 24 — back where it started — and show the same eight products for
   * ever, which is the bug this whole change exists to remove, hiding inside its
   * own fix. So the products turn once per **lap of the aisles** rather than
   * once per hour: every aisle is guaranteed to be drawn at least once while the
   * product window holds still, because a lap's worth of consecutive turns
   * advances the aisle window by `rows × lap ≥ aisles`, and a contiguous window
   * moved that far has covered the whole ring. The lap is measured on the
   * *candidate* aisles rather than the non-empty ones — which are not known
   * until the query below has run — and being too long is the safe direction:
   * it delays the turn, it cannot skip one.
   */
  const buckets = departments.flatMap((department) => {
    const aisles = tree.filter((node) => node.parentId === department.id).slice(0, MAX_AISLES);
    const lap = Math.max(1, Math.ceil(aisles.length / query.rows));

    if (aisles.length === 0) {
      return [
        {
          departmentId: department.id,
          id: department.id,
          members: descendantIds(tree, department.id),
          fallback: false,
          // The department's only row. It is drawn every hour, so its products
          // may turn every hour too.
          productRotation: rotation,
        },
      ];
    }

    return [
      ...aisles.map((aisle) => ({
        departmentId: department.id,
        id: aisle.id,
        members: descendantIds(tree, aisle.id),
        fallback: false,
        productRotation: Math.floor(rotation / lap),
      })),
      {
        departmentId: department.id,
        id: department.id,
        members: [department.id],
        fallback: true,
        // Used only when no aisle has anything in it, and then it is the
        // department's single row — so it too is drawn every hour.
        productRotation: rotation,
      },
    ];
  });

  const membership = buckets.flatMap((bucket) =>
    bucket.members.map(
      (member) => sql`(${member}::uuid, ${bucket.id}::uuid, ${bucket.productRotation}::bigint)`,
    ),
  );
  if (membership.length === 0) return [];

  /*
   * Every aisle's top products, ranked in one pass.
   *
   * `row_number()` partitioned by the bucket is what makes this a single
   * query instead of one per aisle: Postgres walks the candidate products
   * once and numbers them within their own row. The `values` list is the
   * category → row mapping, which is why a subtree costs nothing extra.
   *
   * The order mirrors `orderFor('relevance')` — the owner's featured
   * thumb on the scale, then what actually sells — and ends on the id, so
   * two products with the same standing cannot swap places between reads
   * and make the block look like it shuffled.
   */

  /*
   * Where this turn's eight sit inside the aisle's own ranking.
   *
   * `rn` numbers the aisle from the top and `total` is how long it is, both from
   * the one pass below — so the window is arithmetic on values the pass has
   * already computed, and costs no second query and no second scan. `slot` is a
   * row's distance from the start of the window, counted round the end of the
   * aisle, which makes the wrap free: an aisle of thirty asked for eight from
   * position twenty-six answers 26…30 and then 1…3, in that order, and always
   * returns exactly `min(perRow, total)` rows.
   *
   * Rotating **inside** the aisle is what makes the claim true for products
   * rather than only for aisles. Without it a department could offer every one
   * of its aisles over a lap and still show the same eight phones under
   * Smartphones for ever — the twenty-third phone in the shop would reach the
   * homepage never.
   *
   * `prot` is the bucket's own clock rather than the hour, for the resonance
   * reason set out where the buckets are built.
   *
   * `OFFSET` is what the admin lists were rewritten to avoid and this is not
   * that: the whole partition is numbered in the pass either way, so the filter
   * reads a value already in hand, and this runs once per store per cache miss
   * rather than once per scroll.
   */
  const slot = sql`((rn - 1 + total - (prot * ${query.perRow}::bigint) % total) % total)`;

  const ranked = await store.db.execute<ShowcaseRankRow>(sql`
    with bucket (category_id, bucket_id, product_rotation) as (
      values ${sql.join(membership, sql`, `)}
    )
    select "bucketId", "productId"
      from (
        select b.bucket_id        as "bucketId",
               ${products.id}     as "productId",
               b.product_rotation as prot,
               row_number() over (
                 partition by b.bucket_id
                 order by ${products.isFeatured} desc,
                          ${products.soldCount} desc,
                          ${products.createdAt} desc,
                          ${products.id}
               ) as rn,
               count(*) over (partition by b.bucket_id) as total
          from ${products}
          join bucket b on b.category_id = ${products.categoryId}
         where ${PUBLISHED_PRODUCT}
      ) ranked
     where ${slot} < ${query.perRow}::bigint
     order by "bucketId", ${slot}
  `);

  const idsByBucket = new Map<string, string[]>();
  for (const row of ranked.rows ?? []) {
    const list = idsByBucket.get(row.bucketId);
    if (list) list.push(row.productId);
    else idsByBucket.set(row.bucketId, [row.productId]);
  }

  /*
   * An empty aisle is dropped rather than drawn as an empty row, and the window
   * is taken *after* that — a department whose first three aisles have nothing
   * in them still shows three rows of products instead of three headings over
   * nothing, and an aisle that is empty this hour does not spend a turn.
   *
   * **Which three is this hour's question.** A department with nine aisles drew
   * the first three and only ever those, so two thirds of it were unreachable
   * from the homepage — the chips in the panel header linked to the rest, but a
   * link is not a shop window. The window advances by its own width each hour
   * and wraps, so a lap previews every aisle the department has.
   *
   * The fallback row is a single bucket, so the window over it is a no-op: a
   * department with no aisles of its own has nothing to rotate through.
   */
  const rowsOf = (departmentId: string, fallback: boolean) =>
    rotateWindow(
      buckets
        .filter((bucket) => bucket.departmentId === departmentId && bucket.fallback === fallback)
        .map((bucket) => ({ categoryId: bucket.id, productIds: idsByBucket.get(bucket.id) ?? [] }))
        .filter((row) => row.productIds.length > 0),
      query.rows,
      rotation,
    );

  return departments
    .map((department) => {
      const aisles = rowsOf(department.id, false);
      return {
        categoryId: department.id,
        rows: aisles.length > 0 ? aisles : rowsOf(department.id, true),
      };
    })
    .filter((group) => group.rows.length > 0) satisfies CategoryShowcaseGroup[];
}


/**
 * Category and brand reads.
 *
 * Both are cached for five minutes: a shopper browsing a store hits these on
 * every page and they change only when the owner edits them, at which point the
 * admin write drops the key rather than waiting the TTL out.
 */
export default async function taxonomyRoutes(app: FastifyInstance) {
  /**
   * The category tree, each node carrying how many products are actually in it.
   *
   * The count is over the **subtree**, because that is what the listing behind
   * the link will show — a parent reporting only its own directly-assigned
   * products would say "0" next to a menu entry that opens a full page of them.
   */
  app.get('/categories', async (request, reply) => {
    const store = storeOf(request);

    const tree = await cached(
      tenantKey(store.tenantRef, 'storefront', 'categories'),
      CACHE_TTL.categories,
      async () => {
        const rows = await store.db
          .select({
            id: categories.id,
            parentId: categories.parentId,
            name: categories.name,
            slug: categories.slug,
            imageUrl: categories.imageUrl,
            seoTitle: categories.seoTitle,
            seoDescription: categories.seoDescription,
          })
          .from(categories)
          .where(eq(categories.isActive, true))
          .orderBy(asc(categories.sortOrder), asc(categories.name));

        const counts = await store.db
          .select({ categoryId: products.categoryId, total: count() })
          .from(products)
          .where(PUBLISHED_PRODUCT)
          .groupBy(products.categoryId);

        const directCount = new Map(counts.map((row) => [row.categoryId ?? '', Number(row.total)]));
        const flat = rows.map((row) => ({ id: row.id, parentId: row.parentId, name: row.name, slug: row.slug }));

        const build = (parentId: string | null): CategoryView[] =>
          rows
            .filter((row) => row.parentId === parentId)
            .map((row) => ({
              id: row.id,
              name: row.name,
              slug: row.slug,
              imageUrl: row.imageUrl,
              productCount: descendantIds(flat, row.id).reduce(
                (total, id) => total + (directCount.get(id) ?? 0),
                0,
              ),
              children: build(row.id),
              breadcrumb: breadcrumbFor(flat, row.id),
              seo: { title: row.seoTitle, description: row.seoDescription },
            }));

        return build(null);
      },
    );

    return ok(reply, tree);
  });

  /**
   * The homepage's "shop by category" block, as one read.
   *
   * A department with its aisles listed underneath tells a shopper what the shop
   * is arranged into and nothing about what is in it — so the block that answers
   * "what do you sell" is a row of products *per aisle*, which is the
   * arrangement every large shop uses and the one the directory could not be.
   *
   * It is its own endpoint rather than a shape of `/products`, because the panel
   * asks the same question of a dozen aisles at once. Answered through the
   * listing that would have been twelve HTTP calls, twelve pairs of Redis keys
   * and twelve facet builds — five aggregates over a whole subtree each, for a
   * block that renders no filter panel. Here it is one query: the aisles are
   * ranked in a single pass and the caller resolves the ids it gets back through
   * the listing's own `?ids=` branch, which the homepage was already using.
   *
   * Registered before `/categories/:slug` so the two cannot be confused by a
   * reader; the router prefers a static segment regardless.
   */
  app.get('/categories/showcase', async (request, reply) => {
    const store = storeOf(request);
    const query = parseQuery(showcaseQuerySchema, request.query);
    const rotation = rotationIndex(store.tenantRef);

    const groups = await cached(
      /*
       * Held for the homepage's window rather than the category tree's. It
       * carries no price — but it does carry which products are published, and
       * a shop that hides a product should not see it advertised for another
       * five minutes. An admin write drops the whole `:storefront:` prefix
       * anyway, so this is the ceiling on a change nobody made through the
       * panel.
       *
       * **The rotation is part of the key**, exactly as it is on `/home`, and it
       * has to be: an entry keyed on the query alone would hold the previous
       * hour's aisles for whatever was left of its TTL, so the turn would land
       * anywhere inside a two-minute smear depending on when the last visitor
       * arrived. Keyed this way the flip is exact, the spent hour expires unread,
       * and `invalidateTenantCache` still drops every rotation because it matches
       * the whole `:storefront:` prefix. It is also the same `rotationIndex` the
       * homepage's rails use, so a panel of aisles and the rails around it turn
       * on one stroke rather than two.
       */
      tenantKey(store.tenantRef, 'storefront', 'category-showcase', `r${rotation}`, queryKey(query)),
      CACHE_TTL.homepage,
      () => resolveShowcase(store, query, rotation),
    );

    return ok(reply, groups);
  });

  app.get('/categories/:slug', async (request, reply) => {
    const store = storeOf(request);
    const { slug } = parseParams(slugParamSchema, request.params);

    const [row] = await store.db
      .select()
      .from(categories)
      .where(and(eq(categories.slug, slug), eq(categories.isActive, true)))
      .limit(1);

    // An inactive category answers exactly as a missing one does. Saying "this
    // exists but is hidden" would let anyone map out what a store is preparing.
    if (!row) throw notFound('This category does not exist.');

    const flat = await loadCategoryTree(store);
    const subtree = descendantIds(flat, row.id);

    const [tally] = await store.db
      .select({ total: count() })
      .from(products)
      .where(and(PUBLISHED_PRODUCT, inArray(products.categoryId, subtree)));

    const children = flat.filter((node) => node.parentId === row.id);

    return ok(reply, {
      id: row.id,
      name: row.name,
      slug: row.slug,
      imageUrl: row.imageUrl,
      productCount: Number(tally?.total ?? 0),
      children: children.map((child) => ({
        id: child.id,
        name: child.name,
        slug: child.slug,
        imageUrl: null,
        productCount: 0,
        children: [],
        breadcrumb: [],
        seo: { title: null, description: null },
      })),
      breadcrumb: breadcrumbFor(flat, row.id),
      seo: { title: row.seoTitle, description: row.seoDescription },
    } satisfies CategoryView);
  });

  app.get('/brands', async (request, reply) => {
    const store = storeOf(request);

    const list = await cached(
      tenantKey(store.tenantRef, 'storefront', 'brands'),
      CACHE_TTL.brands,
      async () => {
        const rows = await store.db
          .select({
            id: brands.id,
            name: brands.name,
            slug: brands.slug,
            description: brands.description,
            logoUrl: brands.logoUrl,
            productCount: sql<number>`(
              select count(*)::int from products p
              where p.brand_id = ${brands.id} and p.status = 'active'
            )`,
          })
          .from(brands)
          .where(eq(brands.isActive, true))
          .orderBy(asc(brands.name));

        return rows.map(
          (row) =>
            ({
              id: row.id,
              name: row.name,
              slug: row.slug,
              description: row.description,
              logoUrl: row.logoUrl,
              productCount: Number(row.productCount),
            }) satisfies BrandView,
        );
      },
    );

    return ok(reply, list);
  });

  app.get('/brands/:slug', async (request, reply) => {
    const store = storeOf(request);
    const { slug } = parseParams(slugParamSchema, request.params);

    const [row] = await store.db
      .select()
      .from(brands)
      .where(and(eq(brands.slug, slug), eq(brands.isActive, true)))
      .limit(1);

    if (!row) throw notFound('This brand does not exist.');

    const [tally] = await store.db
      .select({ total: count() })
      .from(products)
      .where(and(PUBLISHED_PRODUCT, eq(products.brandId, row.id)));

    return ok(reply, {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      logoUrl: row.logoUrl,
      productCount: Number(tally?.total ?? 0),
    } satisfies BrandView);
  });
}
