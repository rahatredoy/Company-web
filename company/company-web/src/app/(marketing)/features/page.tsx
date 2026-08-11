import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHero } from '@/components/marketing/page-hero';
import { FeatureGrid } from '@/components/marketing/feature-grid';
import { StorefrontDesign } from '@/components/marketing/storefront-design';
import { CtaSection } from '@/components/marketing/cta-section';

export const metadata: Metadata = {
  title: 'Features',
  description:
    'Product management, orders, inventory, customers, payments, shipping, returns, reports and a fully customisable storefront — everything your store needs.',
};

export default function FeaturesPage() {
  return (
    <>
      <PageHero
        eyebrow="Features"
        title="Everything your online store needs, from day one"
        description="Your store admin panel ships with the tools you need to sell, fulfil and grow — and your data always lives in your own dedicated database."
      >
        <Button asChild size="lg">
          <Link href="/register">
            Start Free Trial <ArrowRight />
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/pricing">View Pricing</Link>
        </Button>
      </PageHero>

      <FeatureGrid />
      <StorefrontDesign />
      <CtaSection />
    </>
  );
}
