import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHero } from '@/components/marketing/page-hero';
import { CtaSection } from '@/components/marketing/cta-section';
import { HOW_IT_WORKS_FULL } from '@/lib/content';
import { getPublicSettings } from '@/lib/public-data';
import { publicEnv } from '@/lib/env';

export const metadata: Metadata = {
  title: 'How It Works',
  description:
    'From registration to a live store in ten steps — account, verification, business details, plan, subdomain, payment, automatic provisioning and admin access.',
};

export default async function HowItWorksPage() {
  const settings = await getPublicSettings();

  return (
    <>
      <PageHero
        eyebrow="How It Works"
        title="From sign up to selling, in ten steps"
        description={`No servers to configure and no code to write. Your store, admin panel and dedicated database are created automatically — with a ${settings.trialDays}-day free trial.`}
      >
        <Button asChild size="lg">
          <Link href="/register">
            Start Free Trial <ArrowRight />
          </Link>
        </Button>
      </PageHero>

      <section className="py-20 sm:py-24">
        <div className="container-page">
          <ol className="relative mx-auto max-w-3xl space-y-6 border-l border-dashed border-border pl-8">
            {HOW_IT_WORKS_FULL.map((item) => (
              <li key={item.step} className="relative">
                <span className="absolute top-1 -left-12 grid size-8 place-items-center rounded-full border border-border bg-card text-xs font-bold text-primary">
                  {item.step}
                </span>
                <div className="rounded-xl border border-border bg-card p-5">
                  <h3 className="text-[15px] font-semibold">{item.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mx-auto mt-12 max-w-3xl rounded-xl border border-border bg-surface p-6">
            <h3 className="text-base font-semibold">What you get the moment provisioning finishes</h3>
            <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
              {[
                `A live storefront on your-store.${publicEnv.rootDomain}`,
                'Your own store admin panel',
                'A dedicated PostgreSQL database',
                'Six storefront templates and eight colour themes',
                'Currency, language and timezone applied',
                'Custom domain ready to connect',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <CtaSection />
    </>
  );
}
