import type { Metadata } from 'next';
import Link from 'next/link';
import { getStoreConfig } from '@/lib/api/store';
import { getFaqs } from '@/lib/api/content';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

export async function generateMetadata(): Promise<Metadata> {
  const config = await getStoreConfig();
  return {
    title: 'Frequently asked questions',
    description: `Answers about ordering, payment, delivery and returns at ${config.store.name}.`,
    alternates: { canonical: '/faq' },
  };
}

/**
 * FAQ, grouped by topic.
 *
 * Every answer is in the served HTML even while its panel is collapsed, so the
 * page is indexable and find-in-page works — which is how most people actually
 * use an FAQ.
 */
export default async function FaqPage() {
  const faqs = await getFaqs();

  const groups = faqs.reduce<Record<string, typeof faqs>>((acc, faq) => {
    const key = faq.category ?? 'General';
    (acc[key] ??= []).push(faq);
    return acc;
  }, {});

  const order = Object.keys(groups);

  return (
    <div className="container-store max-w-3xl py-6">
      <Breadcrumbs items={[{ label: 'FAQ' }]} className="mb-6" />
      <h1 className="text-2xl font-semibold sm:text-3xl">Frequently asked questions</h1>
      <p className="mt-2 text-muted">
        If your question is not here,{' '}
        <Link href="/contact" className="font-medium text-primary hover:underline">
          get in touch
        </Link>{' '}
        and a person will answer.
      </p>

      {order.length === 0 ? (
        <EmptyState
          title="No questions published yet"
          description="Contact us and we will answer directly."
          className="mt-8"
        />
      ) : (
        <div className="mt-10 space-y-10">
          {order.map((group) => (
            <section key={group}>
              <h2 className="text-lg font-semibold">{group}</h2>

              <Accordion type="multiple" className="mt-3 border-t border-border">
                {groups[group]!.map((faq) => (
                  <AccordionItem key={faq.id} value={faq.id}>
                    <AccordionTrigger>{faq.question}</AccordionTrigger>
                    <AccordionContent>
                      <p className="max-w-prose leading-relaxed">{faq.answer}</p>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>
          ))}
        </div>
      )}

      <FaqJsonLd faqs={faqs} />
    </div>
  );
}

/** FAQPage structured data — the one rich result an FAQ reliably earns. */
function FaqJsonLd({ faqs }: { faqs: Awaited<ReturnType<typeof getFaqs>> }) {
  if (faqs.length === 0) return null;

  const json = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json).replace(/</g, '\\u003c') }}
    />
  );
}
