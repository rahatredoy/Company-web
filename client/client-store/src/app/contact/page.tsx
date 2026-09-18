import type { Metadata } from 'next';
import Link from 'next/link';
import { Clock, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { getStoreConfig } from '@/lib/api/store';
import { ContactForm } from '@/components/content/contact-form';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const [config, t] = await Promise.all([getStoreConfig(), getT()]);
  return {
    title: t('Contact us'),
    description: t('Get in touch with {store}.', { store: config.store.name }),
    alternates: { canonical: '/contact' },
  };
}

export default async function ContactPage() {
  const [config, t] = await Promise.all([getStoreConfig(), getT()]);
  const { contact } = config;

  const whatsapp =
    contact.whatsappEnabled && contact.whatsappNumber
      ? contact.whatsappNumber.replace(/\D/g, '')
      : null;

  return (
    <div className="container-store py-6">
      <h1 className="text-2xl font-semibold sm:text-3xl">{t('Contact us')}</h1>
      <p className="mt-2 max-w-prose text-muted">
        {t('A person reads every message. We answer within one working day, usually sooner.')}
      </p>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-16">
        <ContactForm />

        <aside className="space-y-6">
          <div className="rounded-(--radius-card) border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold">{t('Reach us directly')}</h2>

            <ul className="mt-4 space-y-4 text-sm">
              {contact.phone ? (
                <Item icon={Phone} label={t('Phone')}>
                  <Link href={`tel:${contact.phone}`} className="hover:text-primary">
                    {contact.phone}
                  </Link>
                </Item>
              ) : null}

              {contact.email ? (
                <Item icon={Mail} label={t('Email')}>
                  <Link href={`mailto:${contact.email}`} className="hover:text-primary">
                    {contact.email}
                  </Link>
                </Item>
              ) : null}

              {whatsapp ? (
                // i18n-ignore
                <Item icon={MessageCircle} label="WhatsApp">
                  <a
                    href={`https://wa.me/${whatsapp}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="hover:text-primary"
                  >
                    {t('Message us on WhatsApp')}
                  </a>
                </Item>
              ) : null}

              {contact.address ? (
                <Item icon={MapPin} label={t('Address')}>
                  {contact.address}
                </Item>
              ) : null}

              <Item icon={Clock} label={t('Hours')}>
                {t('Saturday to Thursday, 10am–7pm')}
                <span className="block text-xs text-subtle">{t('Closed Friday and public holidays')}</span>
              </Item>
            </ul>
          </div>

          <div className="rounded-(--radius-card) bg-surface-alt p-5 text-sm">
            <h2 className="font-semibold">{t('Chasing an order?')}</h2>
            <p className="mt-1.5 text-muted">
              {t.rich('You can {link} without contacting us — you will need your order number and email.', {
                link: (
                  <Link href="/track-order" className="font-medium text-primary hover:underline">
                    {t('track it here')}
                  </Link>
                ),
              })}
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
