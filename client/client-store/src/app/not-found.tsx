import Link from 'next/link';
import type { Metadata } from 'next';
import { PackageSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('Page not found'),
    robots: { index: false, follow: true },
  };
}

/**
 * The 404.
 *
 * Renders inside the store's own header and footer, so a mistyped URL still
 * lands the visitor somewhere they can shop from rather than on a bare page
 * that looks like the site is broken.
 */
export default async function NotFound() {
  const t = await getT();

  return (
    <div className="container-store grid min-h-[55vh] place-items-center py-16">
      <div className="max-w-md text-center">
        <span className="mx-auto mb-6 grid size-14 place-items-center rounded-full bg-primary-soft text-primary">
          <PackageSearch className="size-6" aria-hidden />
        </span>

        <p className="text-sm font-semibold uppercase tracking-wide text-subtle">{t('Error 404')}</p>
        <h1 className="mt-2 text-3xl font-semibold">{t('Page not found')}</h1>
        <p className="mt-3 text-muted">
          {t('The page you are looking for does not exist, or it may have moved.')}
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/">{t('Go home')}</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/shop">{t('Shop products')}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
