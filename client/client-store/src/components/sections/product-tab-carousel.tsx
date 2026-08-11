'use client';

import * as React from 'react';
import type { ProductSummary } from '@/types';
import type { TemplatePreset } from '@/templates/meta';
import { ProductCard, type ProductCardVariant } from '@/components/commerce/product-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { ProductCarousel } from './product-carousel';

export interface ResolvedTab {
  key: string;
  label: string;
  products: ProductSummary[];
}

/**
 * "Featured · New Arrivals · Best Sellers · On Sale" over a product rail.
 *
 * Every tab's products are resolved on the server before this renders, so
 * switching is instant, needs no request, and cannot be used to hammer the API
 * by clicking back and forth.
 *
 * The tab bar is a real Radix tab widget rather than styled buttons: arrow keys
 * move between tabs, each panel is associated with its tab, and the inactive
 * panels are hidden from the accessibility tree instead of merely off-screen.
 */
export function ProductTabCarousel({
  tabs,
  perView,
  cardVariant,
  gridClassName,
  mode,
  locale,
  limit,
  align = 'center',
  className,
}: {
  tabs: ResolvedTab[];
  perView: TemplatePreset['carouselPerView'];
  cardVariant: ProductCardVariant;
  gridClassName: string;
  mode: TemplatePreset['productSectionMode'];
  locale: string;
  limit: number;
  align?: 'center' | 'left' | 'between';
  className?: string;
}) {
  const usable = tabs.filter((tab) => tab.products.length > 0);
  const [active, setActive] = React.useState(usable[0]?.key ?? '');

  if (usable.length === 0) return null;

  // A single tab needs no tab bar — the section heading already names it.
  if (usable.length === 1) {
    return (
      <div className={className}>
        <TabPanel
          tab={usable[0]!}
          perView={perView}
          cardVariant={cardVariant}
          gridClassName={gridClassName}
          mode={mode}
          locale={locale}
          limit={limit}
        />
      </div>
    );
  }

  return (
    <Tabs value={active} onValueChange={setActive} className={className}>
      <TabsList className={cn('mb-6', align === 'left' && '[justify-content:flex-start]')}>
        {usable.map((tab) => (
          <TabsTrigger key={tab.key} value={tab.key}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {usable.map((tab) => (
        <TabsContent key={tab.key} value={tab.key}>
          <TabPanel
            tab={tab}
            perView={perView}
            cardVariant={cardVariant}
            gridClassName={gridClassName}
            mode={mode}
            locale={locale}
            limit={limit}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function TabPanel({
  tab,
  perView,
  cardVariant,
  gridClassName,
  mode,
  locale,
  limit,
}: {
  tab: ResolvedTab;
  perView: TemplatePreset['carouselPerView'];
  cardVariant: ProductCardVariant;
  gridClassName: string;
  mode: TemplatePreset['productSectionMode'];
  locale: string;
  limit: number;
}) {
  const products = tab.products.slice(0, limit);

  if (mode === 'grid') {
    return (
      <div className={gridClassName}>
        {products.map((product) => (
          <ProductCard key={product.id} product={product} variant={cardVariant} locale={locale} />
        ))}
      </div>
    );
  }

  return (
    <ProductCarousel
      products={products}
      perView={perView}
      cardVariant={cardVariant}
      locale={locale}
      label={tab.label}
    />
  );
}
