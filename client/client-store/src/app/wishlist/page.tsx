import type { Metadata } from 'next';
import { getStoreConfig } from '@/lib/api/store';
import { getTemplate } from '@/templates/registry';
import { readLocalePreference } from '@/lib/locale/preference';
import { WishlistView } from '@/components/commerce/wishlist-view';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('Your wishlist'),
    robots: { index: false, follow: true },
  };
}

export default async function WishlistPage() {
  const config = await getStoreConfig();
  const [locale, template, t] = await Promise.all([
    readLocalePreference(config),
    getTemplate(config.design.templateKey),
    getT(),
  ]);

  return (
    <div className="container-store py-6">
      <h1 className="text-2xl font-semibold sm:text-3xl">{t('Your wishlist')}</h1>

      <WishlistView
        locale={locale.language}
        gridClassName={template.gridClassName}
        cardVariant={template.cardVariant}
      />
    </div>
  );
}
