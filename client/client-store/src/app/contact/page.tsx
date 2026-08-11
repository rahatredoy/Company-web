import type { Metadata } from 'next';
import Link from 'next/link';
import { Clock, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { getStoreConfig } from '@/lib/api/store';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { ContactForm } from '@/components/content/contact-form';

export async function generateMetadata(): Promise<Metadata> {
  const config = await getStoreConfig();
  return {
    title: 'Contact us',
    description: `Get in touch with ${config.store.name}.`,
    alternates: { canonical: '/contact' },
  };
}

export default async function ContactPage() {
  const config = await getStoreConfig();
  const { contact } = config;

  const whatsapp =
    contact.whatsappEnabled && contact.whatsappNumber
      ? contact.whatsappNumber.replace(/\D/g, '')
      : null;

  return (
    <div className="container-store py-6">
      <Breadcrumbs items={[{ label: 'Contact' }]} className="mb-6" />
      <h1 className="text-2xl font-semibold sm:text-3xl">Contact us</h1>
      <p className="mt-2 max-w-prose text-muted">
        A person reads every message. We answer within one working day, usually sooner.
      </p>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-16">
        <ContactForm />

        <aside className="space-y-6">
          <div className="rounded-(--radius-card) border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold">Reach us directly</h2>

            <ul className="mt-4 space-y-4 text-sm">
              {contact.phone ? (
                <Item icon={Phone} label="Phone">
                  <Link href={`tel:${contact.phone}`} className="hover:text-primary">
                    {contact.phone}
                  </Link>
                </Item>
              ) : null}

              {contact.email ? (
                <Item icon={Mail} label="Email">
                  <Link href={`mailto:${contact.email}`} className="hover:text-primary">
                    {contact.email}
                  </Link>
                </Item>
              ) : null}

              {whatsapp ? (
                <Item icon={MessageCircle} label="WhatsApp">
                  <a
                    href={`https://wa.me/${whatsapp}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="hover:text-primary"
                  >
                    Message us on WhatsApp
                  </a>
                </Item>
              ) : null}

              {contact.address ? (
                <Item icon={MapPin} label="Address">
                  {contact.address}
                </Item>
              ) : null}

              <Item icon={Clock} label="Hours">
                Saturday to Thursday, 10am–7pm
                <span className="block text-xs text-subtle">Closed Friday and public holidays</span>
              </Item>
            </ul>
          </div>

          <div className="rounded-(--radius-card) bg-surface-alt p-5 text-sm">
            <h2 className="font-semibold">Chasing an order?</h2>
            <p className="mt-1.5 text-muted">
              You can{' '}
              <Link href="/track-order" className="font-medium text-primary hover:underline">
                track it here
              </Link>{' '}
              without contacting us — you will need your order number and email.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Item({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Phone;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0">
        <span className="block text-xs uppercase tracking-wide text-subtle">{label}</span>
        <span className="block text-foreground">{children}</span>
      </span>
    </li>
  );
}
