import { and, asc, count, eq, ilike, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { faqs, homepageSections, pages, storefrontSettings } from '../../db/schema/index';
import { audit } from '../../lib/audit';
import { invalidateStorefrontOnWrite } from '../../lib/cache';
import {
  COLOR_THEMES,
  STOREFRONT_TEMPLATES,
  normaliseTemplateKey,
  normaliseThemeKey,
} from '../../lib/constants';
import { ERROR_CODES, conflict, notFound } from '../../lib/errors';
import { buildMeta, noContent, ok, paginated, parseBody, parseParams, parseQuery, uuidParamSchema } from '../../lib/http';
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
  type: z.string().trim().min(1).max(40),
  title: z.string().trim().max(200).nullable().default(null),
  subtitle: z.string().trim().max(300).nullable().default(null),
  config: z.record(z.string(), z.unknown()).default({}),
  isEnabled: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
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
        templates: STOREFRONT_TEMPLATES,
        themes: COLOR_THEMES,
      });
    },
  );

  app.put(
    '/website/design',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('website.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const body = parseBody(designSchema, request.body);

      const [existing] = await store.db.select({ id: storefrontSettings.id }).from(storefrontSettings).limit(1);

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
        },
        footerConfiguration: { tagline: body.tagline },
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
          .where(where)
          .orderBy(asc(pages.sortOrder), asc(pages.title))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        store.db.select({ total: count() }).from(pages).where(where),
      ]);

      return paginated(
        reply,
        rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
        buildMeta(query.page, query.pageSize, Number(tally[0]?.total ?? 0)),
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

