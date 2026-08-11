import type { Metadata } from 'next';
import Link from 'next/link';
import { LifeBuoy, Mail, MessageSquare, Phone } from 'lucide-react';
import { PageHero } from '@/components/marketing/page-hero';
import { ContactForm } from '@/components/marketing/contact-form';
import { Card, CardContent } from '@/components/ui/card';
import { getPublicSettings } from '@/lib/public-data';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Talk to our team about plans, migration, custom domains or anything else.',
};

export default async function ContactPage() {
  const settings = await getPublicSettings();

  const channels = [
    { icon: Mail, label: 'Email us', value: settings.supportEmail, href: `mailto:${settings.supportEmail}` },
    settings.supportPhone
      ? { icon: Phone, label: 'Call us', value: settings.supportPhone, href: `tel:${settings.supportPhone}` }
      : null,
    {
      icon: LifeBuoy,
      label: 'Existing customer?',
      value: 'Open a support ticket from your account',
      href: '/dashboard/support',
    },
  ].filter(Boolean) as { icon: typeof Mail; label: string; value: string; href: string }[];

  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Talk to our team"
        description="Questions about a plan, migrating an existing store, or connecting your domain? We are happy to help."
      />

      <section className="py-16 sm:py-20">
        <div className="container-page grid gap-8 lg:grid-cols-[1fr_1.25fr]">
          <div className="space-y-4">
            {channels.map((channel) => (
              <Card key={channel.label}>
                <CardContent className="flex items-start gap-4 p-5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-accent-foreground">
                    <channel.icon className="size-5" aria-hidden />
                  </span>
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold">{channel.label}</p>
                    <Link href={channel.href} className="text-sm text-muted-foreground hover:text-primary">
                      {channel.value}
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}

            <Card>
              <CardContent className="flex items-start gap-4 p-5">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-success-soft text-success">
                  <MessageSquare className="size-5" aria-hidden />
                </span>
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold">Response time</p>
                  <p className="text-sm text-muted-foreground">
                    Most messages are answered within one business day.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-6 sm:p-8">
              <ContactForm />
            </CardContent>
          </Card>
        </div>
      </section>
    </>
  );
}
