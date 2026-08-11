import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHero } from '@/components/marketing/page-hero';
import { publicEnv } from '@/lib/env';

const DOCUMENTS = {
  terms: {
    title: 'Terms of Service',
    description: 'The agreement that governs your use of the platform.',
    sections: [
      {
        heading: 'Your account',
        body: `You are responsible for the accuracy of the information you provide and for keeping your credentials safe. One company administrator account is operated by ${publicEnv.platformName}; your business account is separate and is used only to manage your subscription and store.`,
      },
      {
        heading: 'Subscriptions and trials',
        body: 'Trials begin only once your store has finished provisioning. When a trial ends, your store is paused until a subscription is activated. Subscriptions renew automatically for the selected billing cycle until cancelled.',
      },
      {
        heading: 'Acceptable use',
        body: 'You may not use the platform to sell unlawful goods, to distribute malware, or to attempt to access another tenant’s data or infrastructure. We may suspend an account that puts the platform or other clients at risk.',
      },
      {
        heading: 'Your data',
        body: 'Your commerce data is stored in a database dedicated to your store. You may request an export at any time. We do not delete your data automatically when a subscription lapses.',
      },
      {
        heading: 'Changes',
        body: 'We may update these terms as the service evolves. Material changes are announced by email before they take effect.',
      },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    description: 'What we collect, why we collect it and how it is protected.',
    sections: [
      {
        heading: 'What we collect',
        body: 'Account details (name, email, phone), business profile information, subscription and payment records, and technical logs such as IP address and user agent for security purposes.',
      },
      {
        heading: 'What we never collect',
        body: 'We do not store card numbers. Payments are processed by our payment gateway, which returns only a transaction reference and status to us.',
      },
      {
        heading: 'Your customers’ data',
        body: 'Data belonging to your store’s customers lives in your dedicated database. You are the controller of that data; we process it on your behalf to operate the service.',
      },
      {
        heading: 'Retention',
        body: 'Security and audit logs are retained for a limited period to support investigations. Account and billing records are retained as long as required for legal and accounting purposes.',
      },
      {
        heading: 'Your rights',
        body: `Contact ${publicEnv.supportEmail} to access, correct or export your data, or to ask us to close your account.`,
      },
    ],
  },
  refund: {
    title: 'Refund Policy',
    description: 'When a subscription payment can be refunded.',
    sections: [
      {
        heading: 'Free trial first',
        body: 'The free trial is a plan of its own and can be taken once per account, so you can evaluate the platform before paying. We recommend using it fully before subscribing.',
      },
      {
        heading: 'Refund window',
        body: 'If something goes wrong with your first payment on a plan, contact support within 14 days and we will review a refund of that payment.',
      },
      {
        heading: 'Cancellations',
        body: 'Cancelling stops future renewals. The current paid period continues until its renewal date and is not pro-rated.',
      },
      {
        heading: 'How refunds are issued',
        body: 'Approved refunds are returned through the original payment method and appear on the corresponding invoice as refunded.',
      },
    ],
  },
} as const;

type DocumentKey = keyof typeof DOCUMENTS;

export function generateStaticParams() {
  return Object.keys(DOCUMENTS).map((document) => ({ document }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ document: string }>;
}): Promise<Metadata> {
  const { document } = await params;
  const entry = DOCUMENTS[document as DocumentKey];
  if (!entry) return { title: 'Not found' };
  return { title: entry.title, description: entry.description };
}

export default async function LegalPage({ params }: { params: Promise<{ document: string }> }) {
  const { document } = await params;
  const entry = DOCUMENTS[document as DocumentKey];
  if (!entry) notFound();

  return (
    <>
      <PageHero eyebrow="Legal" title={entry.title} description={entry.description} />
      <section className="py-16 sm:py-20">
        <div className="container-page mx-auto max-w-3xl space-y-8">
          {entry.sections.map((section) => (
            <article key={section.heading} className="space-y-2">
              <h2 className="text-lg font-semibold">{section.heading}</h2>
              <p className="text-sm leading-7 text-muted-foreground">{section.body}</p>
            </article>
          ))}
          <p className="border-t border-border pt-6 text-xs text-muted-foreground">
            Questions about this document? Email {publicEnv.supportEmail}.
          </p>
        </div>
      </section>
    </>
  );
}
