import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { contactMessages, faqs, pages } from '../../db/schema/index';
import { CACHE_TTL, cached, tenantKey } from '../../lib/cache';
import { notFound } from '../../lib/errors';
import { clientIp, noContent, ok, parseBody, parseParams } from '../../lib/http';
import { storeOf } from '../../plugins/tenant';
import type { CmsPageView, FaqView } from './types';

const slugParamSchema = z.object({ slug: z.string().trim().min(1).max(220) });

const contactSchema = z.object({
  name: z.string().trim().min(1, 'Tell us your name.').max(140),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254),
  phone: z.string().trim().max(24).optional(),
  subject: z.string().trim().max(200).optional(),
  message: z.string().trim().min(1, 'Write your message.').max(4000),
});

/**
 * CMS reads and the two small public writes that belong with them.
 *
 * The writes are rate limited per IP on top of the global limiter, because they
 * are the only unauthenticated endpoints on this surface that put a row in the
 * database — the shape a spam script looks for.
 */
export default async function contentRoutes(app: FastifyInstance) {
  app.get('/pages/:slug', async (request, reply) => {
    const store = storeOf(request);
    const { slug } = parseParams(slugParamSchema, request.params);

    const page = await cached(
      tenantKey(store.tenantRef, 'storefront', 'page', slug),
      CACHE_TTL.page,
      async () => {
        const [row] = await store.db
          .select({
            slug: pages.slug,
            title: pages.title,
            excerpt: pages.excerpt,
            bodyHtml: pages.bodyHtml,
            updatedAt: pages.updatedAt,
            seoTitle: pages.seoTitle,
            seoDescription: pages.seoDescription,
          })
          .from(pages)
          // A draft page is not a page. The panel previews its own drafts; this
          // surface answers as though it does not exist.
          .where(and(eq(pages.slug, slug), eq(pages.status, 'published')))
          .limit(1);

        if (!row) return null;

        return {
          slug: row.slug,
          title: row.title,
          excerpt: row.excerpt,
          // Sanitised against an allow-list when it was written, which is what
          // lets the storefront render it as HTML at all.
          bodyHtml: row.bodyHtml,
          updatedAt: row.updatedAt.toISOString(),
          seo: { title: row.seoTitle, description: row.seoDescription },
        } satisfies CmsPageView;
      },
    );

    if (!page) throw notFound('This page does not exist.');

    return ok(reply, page);
  });

  app.get('/faqs', async (request, reply) => {
    const store = storeOf(request);

    const list = await cached(
      tenantKey(store.tenantRef, 'storefront', 'faqs'),
      CACHE_TTL.page,
      async () => {
        const rows = await store.db
          .select({
            id: faqs.id,
            question: faqs.question,
            answer: faqs.answer,
            category: faqs.category,
          })
          .from(faqs)
          .where(eq(faqs.isActive, true))
          .orderBy(asc(faqs.sortOrder), asc(faqs.question));

        return rows satisfies FaqView[];
      },
    );

    return ok(reply, list);
  });

  app.post(
    '/contact',
    {
      config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
    },
    async (request, reply) => {
      const store = storeOf(request);
      const body = parseBody(contactSchema, request.body);

      await store.db.insert(contactMessages).values({
        name: body.name,
        email: body.email,
        phone: body.phone ?? null,
        subject: body.subject ?? null,
        message: body.message,
        // Kept so the owner can recognise a flood from one source; never shown
        // back to the sender and never used to identify them.
        ipAddress: clientIp(request),
      });

      return noContent(reply);
    },
  );
}
