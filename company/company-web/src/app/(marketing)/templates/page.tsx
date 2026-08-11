import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHero } from '@/components/marketing/page-hero';
import { TemplatesShowcase } from '@/components/marketing/templates-showcase';
import { CtaSection } from '@/components/marketing/cta-section';

export const metadata: Metadata = {
  title: 'Storefront Templates',
  description:
    'Six professional storefront templates and eight colour themes — marketplace, modern shop, fashion boutique, minimal, electronics and lifestyle. Switch whenever you like.',
};

export default function TemplatesPage() {
  return (
    <>
      <PageHero
        eyebrow="Templates"
        title="Six designs, eight colour themes"
        description="Every plan includes all six storefront templates and all eight colour themes. Choose them from your own store admin panel, and change your mind any time."
      >
        <Button asChild size="lg">
          <Link href="/register">
            Start Free Trial <ArrowRight />
          </Link>
        </Button>
      </PageHero>

      <TemplatesShowcase showAll />
      <CtaSection />
    </>
  );
}
