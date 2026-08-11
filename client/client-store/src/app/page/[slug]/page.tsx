import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCmsPage } from '@/lib/api/content';
import { getPublishedStoreConfig } from '@/lib/api/store';
import { readLocalePreference } from '@/lib/locale/preference';
import { getStoreConfig } from '@/lib/api/store';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { sanitiseHtml } from '@/lib/sanitise-html';
import { formatDate } from '@/lib/utils';

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
  const [page, config] = await Promise.all([getCmsPage(slug), getPublishedStoreConfig()]);

  if (!page) return { title: 'Page not found', robots: { index: false, follow: true } };

  return {
    title: page.seo.title ?? page.title,
    description: page.seo.description ?? page.excerpt ?? undefined,
    alternates: { canonical: `${config.store.canonicalOrigin}/page/${page.slug}` },
  };
}

export default async function CmsPageRoute({ params }: PageProps) {
  const { slug } = await params;
  const page = await getCmsPage(slug);
  if (!page) notFound();

  const config = await getStoreConfig();
  const locale = await readLocalePreference(config);
  const body = sanitiseHtml(page.bodyHtml);

  return (
    <div className="container-store max-w-3xl py-6">
      <Breadcrumbs items={[{ label: page.title }]} className="mb-6" />

      <header>
        <h1 className="text-2xl font-semibold sm:text-3xl">{page.title}</h1>
        {page.excerpt ? <p className="mt-2 text-muted">{page.excerpt}</p> : null}
        <p className="mt-3 text-xs text-subtle">
          Last updated{' '}
          <time dateTime={page.updatedAt}>{formatDate(page.updatedAt, locale.language)}</time>
        </p>
      </header>

      {body ? (
        <div
          className="cms-content mt-8"
          // Sanitised on the API, and again by `sanitiseHtml` immediately above.
          dangerouslySetInnerHTML={{ __html: body }}
        />
      ) : (
        <p className="mt-8 text-muted">This page has no content yet.</p>
      )}
    </div>
  );
}
