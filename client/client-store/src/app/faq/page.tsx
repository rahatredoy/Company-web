import type { Metadata } from 'next';
import Link from 'next/link';
import { getStoreConfig } from '@/lib/api/store';
import { getFaqs } from '@/lib/api/content';
import { EmptyState } from '@/components/ui/empty-state';
import { getT } from '@/lib/i18n/server';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

export async function generateMetadata(): Promise<Metadata> {
  const [config, t] = await Promise.all([getStoreConfig(), getT()]);
  return {
    title: t('Frequently asked questions'),
    description: t('Answers about ordering, payment, delivery and returns at {store}.', {
      store: config.store.name,
    }),
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
  const [stored, t] = await Promise.all([getFaqs(), getT()]);

  /*
   * A new store opens with four seeded questions, and the owner's panel may
   * never be used to reword them — so a question still reading exactly as it was
   * seeded is shown in the visitor's language, and one the owner wrote is shown
   * as they wrote it. The structured data below reads the same text the page
   * shows, which is the text a search result should quote.
   */
  const faqs = stored.map((faq) => ({
    ...faq,
    question: t.loose(faq.question),
    answer: t.loose(faq.answer),
    category: faq.category ? t.loose(faq.category) : null,
  }));

  const groups = faqs.reduce<Record<string, typeof faqs>>((acc, faq) => {
    const key = faq.category ?? t('General');
    (acc[key] ??= []).push(faq);
    return acc;
  }, {});

  const order = Object.keys(groups);

  return (
    <div className="container-store max-w-3xl py-6">
      <h1 className="text-2xl font-semibold sm:text-3xl">{t('Frequently asked questions')}</h1>
      <p className="mt-2 text-muted">
        {t.rich('If your question is not here, {link} and a person will answer.', {
          link: (
            <Link href="/contact" className="font-medium text-primary hover:underline">
              {t('get in touch')}
            </Link>
          ),
        })}
      </p>

      {order.length === 0 ? (
        <EmptyState
          title={t('No questions published yet')}
          description={t('Contact us and we will answer directly.')}
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
