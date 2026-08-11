import { Hero } from '@/components/marketing/hero';
import { LogoStrip } from '@/components/marketing/logo-strip';
import { FeatureGrid } from '@/components/marketing/feature-grid';
import { TemplatesShowcase } from '@/components/marketing/templates-showcase';
import { HowItWorks } from '@/components/marketing/how-it-works';
import { SecurityTestimonial } from '@/components/marketing/security-testimonial';
import { PricingSection } from '@/components/marketing/pricing-section';
import { FaqSection } from '@/components/marketing/faq-section';
import { CtaSection } from '@/components/marketing/cta-section';
import { getPublicPlans, getPublicSettings } from '@/lib/public-data';

export default async function HomePage() {
  const [plans, settings] = await Promise.all([getPublicPlans(), getPublicSettings()]);

  return (
    <>
      <Hero trialDays={settings.trialDays} />
      <LogoStrip />
      <FeatureGrid limit={6} showCta />
      <TemplatesShowcase />
      <HowItWorks />
      <SecurityTestimonial />
      <PricingSection plans={plans} trialDays={settings.trialDays} />
      <FaqSection limit={6} />
      <CtaSection />
    </>
  );
}
