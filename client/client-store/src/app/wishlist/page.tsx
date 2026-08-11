import type { Metadata } from 'next';
import { getStoreConfig } from '@/lib/api/store';
import { getTemplate } from '@/templates/registry';
import { readLocalePreference } from '@/lib/locale/preference';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { WishlistView } from '@/components/commerce/wishlist-view';

export const metadata: Metadata = {
  title: 'Your wishlist',
  robots: { index: false, follow: true },
};

export default async function WishlistPage() {
  const config = await getStoreConfig();
  const [locale, template] = await Promise.all([
    readLocalePreference(config),
    getTemplate(config.design.templateKey),
  ]);

  return (
    <div className="container-store py-6">
      <Breadcrumbs items={[{ label: 'Wishlist' }]} className="mb-6" />
      <h1 className="text-2xl font-semibold sm:text-3xl">Your wishlist</h1>

      <WishlistView
        locale={locale.language}
        gridClassName={template.gridClassName}
        cardVariant={template.cardVariant}
      />
    </div>
  );
}
