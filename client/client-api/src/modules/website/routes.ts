import { and, asc, count, eq, ilike, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { faqs, homepageSections, pages, storefrontSettings } from '../../db/schema/index';
import { audit } from '../../lib/audit';
import { invalidateStorefrontOnWrite } from '../../lib/cache';
import {
  CATEGORY_ICON_KEYS,
  COLOR_THEMES,
  HOMEPAGE_SECTION_TYPES,
  MOBILE_NAV_ICONS,
  SOCIAL_PLATFORMS,
  STOREFRONT_TEMPLATES,
  normaliseTemplateKey,
  normaliseThemeKey,
} from '../../lib/constants';
import { ERROR_CODES, conflict, notFound } from '../../lib/errors';
import {
  cursorField,
  listed,
  noContent,
  ok,
  parseBody,
  parseParams,
  parseQuery,
  uuidParamSchema,
} from '../../lib/http';
import { keyset } from '../../lib/keyset';
import { sanitiseHtml } from '../../lib/sanitise';
import { slugify } from '../../lib/utils';
import { storeOf } from '../../plugins/tenant';

const designSchema = z.object({
  templateKey: z.enum(STOREFRONT_TEMPLATES),
  colorThemeKey: z.enum(COLOR_THEMES),
  logoUrl: z.string().trim().url('Use a full web address.').max(2000).nullable().default(null),
  faviconUrl: z.string().trim().url('Use a full web address.').max(2000).nullable().default(null),
  announcement: z
    .object({
      enabled: z.boolean().default(false),
      messages: z
        .array(
          z.object({
            text: z.string().trim().min(1).max(200),
            linkUrl: z.string().trim().max(2000).nullable().default(null),
            linkLabel: z.string().trim().max(60).nullable().default(null),
          }),
        )
        .max(5)
        .default([]),
    })
    .default({ enabled: false, messages: [] }),
  tagline: z.string().trim().max(200).nullable().default(null),

  /*
   * Everything below is `.optional()` while everything above is required, and
   * the difference is deliberate: this is a full-replace endpoint, so a field
   * the caller omits is a field set back to its default. The admin panel's
   * design form owns the keys above and round-trips them; it knows nothing about
   * the footer columns or social profiles, so defaulting those to `[]` would let
   * a template change silently empty the footer of every page. Omitted here
   * means "leave what is stored alone".
   */
  social: z
    .array(
      z.object({
        platform: z.enum(SOCIAL_PLATFORMS),
        url: z.string().trim().url('Use a full web address.').max(2000),
      }),
    )
    .max(8)
    .optional(),
  footerColumns: z
    .array(
      z.object({
        id: z.string().trim().max(40).optional(),
        title: z.string().trim().min(1).max(60),
        links: z
          .array(
            z.object({
              label: z.string().trim().min(1).max(60),
              href: z.string().trim().min(1).max(2000),
            }),
          )
          .max(12),
      }),
    )
    .max(6)
    .optional(),
  utility: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(40),
        href: z.string().trim().min(1).max(2000),
      }),
    )
    .max(6)
    .optional(),
  mobileNav: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(20),
        href: z.string().trim().min(1).max(2000),
        icon: z.enum(MOBILE_NAV_ICONS),
      }),
    )
    .max(5)
    .optional(),
  /** Category slug → glyph key, for the sidebar and mobile drawer. */
  categoryIcons: z.record(z.string().trim().max(160), z.enum(CATEGORY_ICON_KEYS)).optional(),
});

const pageSchema = z.object({
  title: z.string().trim().min(1, 'Give the page a title.').max(200),
  slug: z.string().trim().max(220).optional(),
  excerpt: z.string().trim().max(500).nullable().default(null),
  bodyHtml: z.string().max(200_000).nullable().default(null),
  status: z.enum(['draft', 'published']).default('draft'),
  showInFooter: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
  seoTitle: z.string().trim().max(160).nullable().default(null),
  seoDescription: z.string().trim().max(300).nullable().default(null),
});

const faqSchema = z.object({
  question: z.string().trim().min(1, 'Ask something.').max(300),
  answer: z.string().trim().min(1, 'Answer it.').max(4000),
  category: z.string().trim().max(60).nullable().default(null),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
});

const sectionSchema = z.object({
  title: z.string().trim().max(200).nullable().default(null),
  subtitle: z.string().trim().max(300).nullable().default(null),
  config: z.record(z.string(), z.unknown()).default({}),
  isEnabled: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
});

/**
 * Creating a section additionally fixes its `type`, which updating cannot change.
 *
 * A section's type decides which renderer runs and which `config` keys mean
 * anything, so re-typing one in place would leave a hero's slides sitting in a
 * brands block. Changing the type is delete-and-create.
 *
 * The enum is checked here rather than left to Postgres: an unknown value would
 * otherwise arrive as a driver error and be reported as a 500, when it is really
 * one bad field.
 */
const createSectionSchema = sectionSchema.extend({
  type: z.enum(HOMEPAGE_SECTION_TYPES),
});

/**
 * The shopfront's own appearance and copy.
 *
 * Two rules run through all of it. **`bodyHtml` is sanitised on write**, because
 * the storefront renders it as HTML and trusts that it was — a store admin
 * password should not be a route to script execution on every visitor's browser.
 * And **every write drops the storefront cache**, since this is the section
 * whose whole purpose is changing what the public sees.
 */
export default async function websiteRoutes(app: FastifyInstance) {
  invalidateStorefrontOnWrite(app);

  // -------------------------------------------------------------- design ----

  app.get(
    '/website/design',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('website.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const [row] = await store.db.select().from(storefrontSettings).limit(1);

      const header = (row?.headerConfiguration ?? {}) as Record<string, any>;
      const footer = (row?.footerConfiguration ?? {}) as Record<string, any>;

      return ok(reply, {
        templateKey: normaliseTemplateKey(row?.templateKey ?? ''),
        colorThemeKey: normaliseThemeKey(row?.colorThemeKey ?? ''),
        logoUrl: row?.logoUrl ?? null,
        faviconUrl: row?.faviconUrl ?? null,
        announcement: {
          enabled: header.announcement?.enabled === true,
          messages: Array.isArray(header.announcement?.messages) ? header.announcement.messages : [],
        },
        tagline: typeof footer.tagline === 'string' ? footer.tagline : null,
        social: Array.isArray(footer.social) ? footer.social : [],
        footerColumns: Array.isArray(footer.columns) ? footer.columns : [],
        utility: Array.isArray(header.utility) ? header.utility : [],
        mobileNav: Array.isArray(header.mobileNav) ? header.mobileNav : [],
        categoryIcons: header.categoryIcons ?? {},
        templates: STOREFRONT_TEMPLATES,
        themes: COLOR_THEMES,
        socialPlatforms: SOCIAL_PLATFORMS,
        mobileNavIcons: MOBILE_NAV_ICONS,
        categoryIconKeys: CATEGORY_ICON_KEYS,
      });
    },
  );

  app.put(
    '/website/design',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('website.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const body = parseBody(designSchema, request.body);

      const [existing] = await store.db
        .select({
          id: storefrontSettings.id,
          headerConfiguration: storefrontSettings.headerConfiguration,
          footerConfiguration: storefrontSettings.footerConfiguration,
        })
        .from(storefrontSettings)
        .limit(1);

      // Omitted keys keep what is stored; see the note on `designSchema`.
      const storedHeader = (existing?.headerConfiguration ?? {}) as Record<string, unknown>;
      const storedFooter = (existing?.footerConfiguration ?? {}) as Record<string, unknown>;
      const keep = <T>(sent: T | undefined, stored: unknown, empty: T): T =>
        sent !== undefined ? sent : ((stored ?? empty) as T);

      const values = {
        templateKey: body.templateKey,
        colorThemeKey: body.colorThemeKey,
        logoUrl: body.logoUrl,
        faviconUrl: body.faviconUrl,
        headerConfiguration: {
          announcement: {
            enabled: body.announcement.enabled,
            messages: body.announcement.messages.map((message, index) => ({
              id: `announcement-${index}`,
              ...message,
            })),
          },
          utility: keep(body.utility, storedHeader.utility, []),
          mobileNav: keep(body.mobileNav, storedHeader.mobileNav, []),
          categoryIcons: keep(body.categoryIcons, storedHeader.categoryIcons, {}),
        },
        footerConfiguration: {
          tagline: body.tagline,
          social: keep(body.social, storedFooter.social, []),
          columns: keep(
            body.footerColumns?.map((column, index) => ({ id: column.id ?? `column-${index}`, ...column })),
            storedFooter.columns,
            [],
          ),
        },
        publishedAt: new Date(),
        updatedAt: new Date(),
      };

      // The design row is a singleton — `ensureStoreSeed` creates it, but a
      // tenant migrated in from elsewhere may not have one.
      const [saved] = existing
        ? await store.db.update(storefrontSettings).set(values).where(eq(storefrontSettings.id, existing.id)).returning()
        : await store.db.insert(storefrontSettings).values(values).returning();

      await audit(store.db, request, {
        action: 'website.design',
        module: 'website',
        entity: 'storefront_settings',
        entityId: saved!.id,
        entityLabel: `${body.templateKey} / ${body.colorThemeKey}`,
        newValues: { templateKey: body.templateKey, colorThemeKey: body.colorThemeKey },
      });

      return ok(reply, saved);
    },
  );

  // --------------------------------------------------------------- pages ----

  app.get(
    '/website/pages',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('website.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const query = parseQuery(
        z.object({
          ...cursorField,
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(20),
          search: z.string().trim().max(120).optional(),
          status: z.string().trim().max(40).optional(),
        }),
        request.query,
      );

      const filters = [
        query.search ? ilike(pages.title, `%${query.search}%`) : undefined,
        query.status && query.status !== 'all' ? eq(pages.status, query.status as 'draft') : undefined,
      ].filter(Boolean);

      const where = filters.length ? and(...filters) : undefined;

      /*
       * Author's order, then title, then the id. The id is what makes the order
       * total — every seeded page shares `sort_order = 0`, so without it a cursor
       * would be pointing into a set of rows the database may return in any
       * order, and a batch boundary would drop one page and repeat another.
       */
      const page = keyset<{ id: string; sortOrder: number; title: string }>([
        { expr: pages.sortOrder, order: 'asc', of: (row) => row.sortOrder },
        { expr: pages.title, order: 'asc', of: (row) => row.title },
        { expr: pages.id, order: 'asc', of: (row) => row.id },
      ]);

      const seek = page.after(query.cursor);
      const scan = seek ? and(seek, ...filters) : where;

      const [rows, tally] = await Promise.all([
        store.db
          .select({
            id: pages.id,
            title: pages.title,
            slug: pages.slug,
            systemKey: pages.systemKey,
            status: pages.status,
            showInFooter: pages.showInFooter,
            sortOrder: pages.sortOrder,
            updatedAt: pages.updatedAt,
          })
          .from(pages)
          .where(scan)
          .orderBy(...page.orderBy)
          // One row more than fits, which separates "there is another batch"
          // from "that was the last one" without a second query.
          .limit(query.pageSize + 1)
          .offset(query.cursor ? 0 : (query.page - 1) * query.pageSize),

        // Counted on the first batch only: the scroll shows the figure once, and
        // the count is the half of a list read that cannot stop at `pageSize`.
        query.cursor ? undefined : store.db.select({ total: count() }).from(pages).where(where),
      ]);

      const batch = page.batch(rows, query.pageSize);

      return listed(
        reply,
        batch.rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
        {
          pageSize: query.pageSize,
          nextCursor: batch.nextCursor,
          hasMore: batch.hasMore,
          total: tally ? Number(tally[0]?.total ?? 0) : undefined,
        },
      );
    },
  );

  app.get(
    '/website/pages/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('website.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const [row] = await store.db.select().from(pages).where(eq(pages.id, id)).limit(1);
      if (!row) throw notFound('That page does not exist.');

      return ok(reply, { ...row, updatedAt: row.updatedAt.toISOString(), createdAt: row.createdAt.toISOString() });
    },
  );

  app.post(
    '/website/pages',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('website.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const body = parseBody(pageSchema, request.body);

      const slug = await settlePageSlug(store.db, body.slug, body.title);

      const [created] = await store.db
        .insert(pages)
        .values({
          ...body,
          slug,
          bodyHtml: body.bodyHtml === null ? null : sanitiseHtml(body.bodyHtml),
          publishedAt: body.status === 'published' ? new Date() : null,
        })
        .returning();

      await audit(store.db, request, {
        action: 'page.create',
        module: 'website',
        entity: 'page',
        entityId: created!.id,
        entityLabel: created!.title,
      });

      return ok(reply, created, 201);
    },
  );

  app.put(
    '/website/pages/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('website.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(pageSchema, request.body);

      const [existing] = await store.db.select().from(pages).where(eq(pages.id, id)).limit(1);
      if (!existing) throw notFound('That page does not exist.');

      /*
       * A rename never moves a live address. The slug is re-derived only when
       * the slug itself was the field being changed — the same rule the
       * catalogue keeps, for the same reason: every link to that page breaks.
       */
      const slug =
        body.slug && body.slug !== existing.slug
          ? await settlePageSlug(store.db, body.slug, body.title, id)
          : existing.slug;

      const [updated] = await store.db
        .update(pages)
        .set({
          ...body,
          slug,
          bodyHtml: body.bodyHtml === null ? null : sanitiseHtml(body.bodyHtml),
          publishedAt:
            body.status === 'published' ? (existing.publishedAt ?? new Date()) : null,
          updatedAt: new Date(),
        })
        .where(eq(pages.id, id))
        .returning();

      await audit(store.db, request, {
        action: 'page.update',
        module: 'website',
        entity: 'page',
        entityId: id,
        entityLabel: updated!.title,
      });

      return ok(reply, updated);
    },
  );

  app.delete(
    '/website/pages/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('website.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const [existing] = await store.db
        .select({ id: pages.id, title: pages.title, systemKey: pages.systemKey })
        .from(pages)
        .where(eq(pages.id, id))
        .limit(1);

      if (!existing) throw notFound('That page does not exist.');

      // A policy page is linked from the footer and from checkout copy; losing
      // one leaves dead links a shop owner will not think to look for.
      if (existing.systemKey) {
        throw conflict(
          'This is one of your policy pages. Empty it or unpublish it rather than deleting it.',
        );
      }

      await store.db.delete(pages).where(eq(pages.id, id));

      await audit(store.db, request, {
        action: 'page.delete',
        module: 'website',
        entity: 'page',
        entityId: id,
        entityLabel: existing.title,
      });

      return noContent(reply);
    },
  );

  // ---------------------------------------------------------------- faqs ----

  app.get(
    '/website/faqs',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('website.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const rows = await store.db.select().from(faqs).orderBy(asc(faqs.sortOrder), asc(faqs.question));
      return ok(reply, rows);
    },
  );

  app.post(
    '/website/faqs',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('website.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const body = parseBody(faqSchema, request.body);
      const [created] = await store.db.insert(faqs).values(body).returning();
      return ok(reply, created, 201);
    },
  );

  app.put(
    '/website/faqs/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('website.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(faqSchema, request.body);

      const [updated] = await store.db
        .update(faqs)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(faqs.id, id))
        .returning();

      if (!updated) throw notFound('That question does not exist.');

      return ok(reply, updated);
    },
  );

  app.delete(
    '/website/faqs/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('website.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const [removed] = await store.db.delete(faqs).where(eq(faqs.id, id)).returning({ id: faqs.id });
      if (!removed) throw notFound('That question does not exist.');

      return noContent(reply);
    },
  );

  // ------------------------------------------------------------ homepage ----

  app.get(
    '/website/homepage',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('website.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const rows = await store.db
        .select()
        .from(homepageSections)
        .orderBy(asc(homepageSections.sortOrder));
      return ok(reply, rows);
    },
  );

  app.post(
    '/website/homepage',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('website.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const body = parseBody(createSectionSchema, request.body);

      const [created] = await store.db.insert(homepageSections).values(body).returning();

      await audit(store.db, request, {
        action: 'homepage.section.create',
        module: 'website',
        entity: 'homepage_section',
        entityId: created!.id,
        entityLabel: created!.title ?? created!.type,
        newValues: { type: created!.type, sortOrder: created!.sortOrder },
      });

      return ok(reply, created, 201);
    },
  );

  app.delete(
    '/website/homepage/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('website.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const [removed] = await store.db
        .delete(homepageSections)
        .where(eq(homepageSections.id, id))
        .returning({ id: homepageSections.id, type: homepageSections.type });

      if (!removed) throw notFound('That section does not exist.');

      await audit(store.db, request, {
        action: 'homepage.section.delete',
        module: 'website',
        entity: 'homepage_section',
        entityId: removed.id,
        entityLabel: removed.type,
        oldValues: { type: removed.type },
      });

      return noContent(reply);
    },
  );

  app.put(
    '/website/homepage/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('website.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(sectionSchema, request.body);

      const [updated] = await store.db
        .update(homepageSections)
        .set({
          title: body.title,
          subtitle: body.subtitle,
          config: body.config,
          isEnabled: body.isEnabled,
          sortOrder: body.sortOrder,
          updatedAt: new Date(),
        })
        .where(eq(homepageSections.id, id))
        .returning();

      if (!updated) throw notFound('That section does not exist.');

      return ok(reply, updated);
    },
  );
}

/**
 * A page slug that does not collide.
 *
 * A derived slug that clashes gets a numeric suffix; one that was explicitly
 * asked for and clashes is refused, exactly as the catalogue behaves — the
 * difference being whether somebody chose the address on purpose.
 */
async function settlePageSlug(
  db: ReturnType<typeof storeOf>['db'],
  requested: string | undefined,
  title: string,
  exceptId?: string,
): Promise<string> {
  const isTaken = async (candidate: string) => {
    const conditions = [eq(pages.slug, candidate)];
    if (exceptId) conditions.push(sql`${pages.id} <> ${exceptId}`);
    const [row] = await db.select({ id: pages.id }).from(pages).where(and(...conditions)).limit(1);
    return Boolean(row);
  };

  if (requested) {
    const slug = slugify(requested);
    if (await isTaken(slug)) throw conflict('That address is already in use.', ERROR_CODES.PAGE_SLUG_TAKEN);
    return slug;
  }

  const base = slugify(title) || 'page';
  for (let suffix = 1; suffix <= 200; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    if (!(await isTaken(candidate))) return candidate;
  }

  throw conflict('Could not find a free address for that title.', ERROR_CODES.PAGE_SLUG_TAKEN);
}

