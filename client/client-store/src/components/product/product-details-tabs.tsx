'use client';

import * as React from 'react';
import type { ProductDetail } from '@/types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

/**
 * Description, specifications, shipping and returns.
 *
 * A tab bar on desktop, an accordion on a phone — the same four panels either
 * way. Four tabs across a 390px screen either wrap into an unreadable stack or
 * scroll sideways past content nobody knows is there.
 *
 * Every panel is in the served HTML in both layouts, so all of it is indexable
 * and reachable by find-in-page even while collapsed.
 */
export function ProductDetailsTabs({ product }: { product: ProductDetail }) {
  const panels = React.useMemo(() => {
    const entries: { key: string; label: string; content: React.ReactNode }[] = [];

    if (product.description) {
      entries.push({
        key: 'description',
        label: 'Description',
        content: (
          <div className="max-w-prose space-y-4 text-sm leading-relaxed text-muted">
            {product.description.split('\n\n').map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        ),
      });
    }

    if (product.specifications.length > 0) {
      entries.push({
        key: 'specifications',
        label: 'Specifications',
        content: (
          <dl className="max-w-2xl divide-y divide-border text-sm">
            {product.specifications.map((spec) => (
              <div key={spec.label} className="grid grid-cols-[10rem_1fr] gap-4 py-3">
                <dt className="text-subtle">{spec.label}</dt>
                <dd className="text-foreground">{spec.value}</dd>
              </div>
            ))}
          </dl>
        ),
      });
    }

    if (product.shippingInfo) {
      entries.push({
        key: 'shipping',
        label: 'Shipping',
        content: <p className="max-w-prose text-sm leading-relaxed text-muted">{product.shippingInfo}</p>,
      });
    }

    entries.push({
      key: 'returns',
      label: 'Returns',
      content: (
        <p className="max-w-prose text-sm leading-relaxed text-muted">
          {product.isReturnable
            ? (product.returnInfo ?? 'Thirty-day returns on unworn items with tags attached.')
            : 'This item cannot be returned once opened, for hygiene reasons. Your statutory rights are unaffected.'}
        </p>
      ),
    });

    return entries;
  }, [product]);

  if (panels.length === 0) return null;

  return (
    <>
      <div className="hidden sm:block">
        <Tabs defaultValue={panels[0]!.key}>
          <TabsList className="[justify-content:flex-start]">
            {panels.map((panel) => (
              <TabsTrigger key={panel.key} value={panel.key}>
                {panel.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {panels.map((panel) => (
            <TabsContent key={panel.key} value={panel.key} className="pt-6">
              {panel.content}
            </TabsContent>
          ))}
        </Tabs>
      </div>

      <div className="sm:hidden">
        <Accordion type="single" collapsible defaultValue={panels[0]!.key} className="border-t border-border">
          {panels.map((panel) => (
            <AccordionItem key={panel.key} value={panel.key}>
              <AccordionTrigger>{panel.label}</AccordionTrigger>
              <AccordionContent>{panel.content}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </>
  );
}
