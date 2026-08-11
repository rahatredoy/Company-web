import type { Metadata } from 'next';
import { PageHero } from '@/components/marketing/page-hero';
import { PricingSection } from '@/components/marketing/pricing-section';
import { FaqSection } from '@/components/marketing/faq-section';
import { CtaSection } from '@/components/marketing/cta-section';
import { getPublicPlans, getPublicSettings } from '@/lib/public-data';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Simple, transparent pricing. A one-per-account free trial, a free platform subdomain and a dedicated PostgreSQL database.',
};

export default async function PricingPage() {
  const [plans, settings] = await Promise.all([getPublicPlans(), getPublicSettings()]);

  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title="Pricing that grows with your business"
        description={`Start with a ${settings.trialDays}-day free trial. Upgrade, downgrade or cancel at any time — we never delete your data automatically.`}
      />
      <PricingSection plans={plans} trialDays={settings.trialDays} />
      <FaqSection />
      <CtaSection />
    </>
  );
}
