import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCmsPage } from '@/lib/api/content';
import { getPublishedStoreConfig } from '@/lib/api/store';
import { getT } from '@/lib/i18n/server';
import { sanitiseHtml } from '@/lib/sanitise-html';

/**
 * Store-authored content: policies, about, anything the owner publishes.
 *
 * The body is HTML the API has already sanitised, and it is sanitised **again**
 * here against a small allow-list before it reaches `dangerouslySetInnerHTML`.
 * This is the one place in the storefront where admin-authored markup becomes
 * live DOM, so it is the one place worth being paranoid about — the CSP in
 * `next.config.ts` is the layer behind this if both passes are ever bypassed.
 */

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const [page, config, t] = await Promise.all([getCmsPage(slug), getPublishedStoreConfig(), getT()]);

  if (!page) return { title: t('Page not found'), robots: { index: false, follow: true } };

  // The seeded policy pages' titles and summaries are translated while they are
  // still the seed's words; an SEO title is the owner's by definition.
  return {
    title: page.seo.title ?? t.loose(page.title),
    description: page.seo.description ?? (page.excerpt ? t.loose(page.excerpt) : undefined),
    alternates: { canonical: `${config.store.canonicalOrigin}/page/${page.slug}` },
  };
}

export default async function CmsPageRoute({ params }: PageProps) {
  const { slug } = await params;
  const page = await getCmsPage(slug);
  if (!page) notFound();

  const t = await getT();
  const body = sanitiseHtml(page.bodyHtml);

  return (
    <div className="container-store max-w-3xl py-6">
      <header>
        {/* The body is HTML the owner writes and is never passed through the
            dictionary; the title and summary above it are plain text and are. */}
        <h1 className="text-2xl font-semibold sm:text-3xl">{t.loose(page.title)}</h1>
        {page.excerpt ? <p className="mt-2 text-muted">{t.loose(page.excerpt)}</p> : null}
        <p className="mt-3 text-xs text-subtle">
          {t.rich('Last updated {date}', {
            date: <time dateTime={page.updatedAt}>{t.date(page.updatedAt)}</time>,
          })}
        </p>
      </header>

      {body ? (
        <div
          className="cms-content mt-8"
          // Sanitised on the API, and again by `sanitiseHtml` immediately above.
          dangerouslySetInnerHTML={{ __html: body }}
        />
      ) : (
        <p className="mt-8 text-muted">{t('This page has no content yet.')}</p>
      )}
    </div>
  );
}
