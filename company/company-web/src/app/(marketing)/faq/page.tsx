import type { Metadata } from 'next';
import { PageHero } from '@/components/marketing/page-hero';
import { FaqSection } from '@/components/marketing/faq-section';
import { CtaSection } from '@/components/marketing/cta-section';

export const metadata: Metadata = {
  title: 'FAQ',
  description: 'Answers about trials, custom domains, plan changes, data security and payments.',
};

export default function FaqPage() {
  return (
    <>
      <PageHero
        eyebrow="FAQ"
        title="Questions, answered"
        description="If you cannot find what you are looking for, our team is one message away."
      />
      <FaqSection />
      <CtaSection />
    </>
  );
}
