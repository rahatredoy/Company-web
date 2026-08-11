import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Package, Palette, ShieldCheck, Warehouse } from 'lucide-react';
import { PageHeader } from '@/components/admin/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { serverGetOptional } from '@/lib/server-api';
import type { SessionResponse } from '@/lib/types';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

/**
 * Set-up checklist for a store that has nothing in it yet. The trading metrics
 * that replace it need orders to exist, so they arrive with that slice rather
 * than being faked here.
 */
const SETUP_STEPS = [
  {
    icon: Package,
    title: 'Add your first products',
    description: 'Build your catalogue with categories, brands and variants.',
    href: '/products',
    action: 'Go to products',
  },
  {
    icon: Warehouse,
    title: 'Set up stock',
    description: 'Create a warehouse and record what you have on hand.',
    href: '/inventory',
    action: 'Go to inventory',
  },
  {
    icon: Palette,
    title: 'Choose how your store looks',
    description: 'Pick one of six templates and six colour themes.',
    href: '/website/design',
    action: 'Open design',
  },
  {
    icon: ShieldCheck,
    title: 'Turn on two-factor authentication',
    description: 'Strongly recommended for the account that owns the store.',
    href: '/account/security',
    action: 'Open security',
  },
];

export default async function DashboardPage() {
  const session = await serverGetOptional<SessionResponse>('/api/v1/admin/auth/session');
  const admin = session?.authenticated ? session.admin : null;
  const store = session?.authenticated ? session.store : null;
  const firstName = admin?.fullName.split(' ')[0] ?? 'there';

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description={`${store?.name ?? 'Your store'} · ${store?.currency ?? 'USD'} · ${store?.timezone ?? 'UTC'}`}
      />

      {store?.trial && store.trial.status === 'active' ? (
        <Card className="border-warning/40 bg-warning-soft/60">
          <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">
                Your trial ends in {store.trial.daysRemaining} day
                {store.trial.daysRemaining === 1 ? '' : 's'}
              </CardTitle>
              <CardDescription>
                Add a payment method from your platform account to keep the store trading.
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
      ) : null}

      <section aria-labelledby="setup-heading" className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 id="setup-heading" className="text-lg font-semibold">
            Finish setting up
          </h2>
          <Badge variant="neutral">{SETUP_STEPS.length} steps</Badge>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {SETUP_STEPS.map((step) => (
            <Card key={step.href} className="flex flex-col">
              <CardHeader>
                <span className="mb-2 grid size-10 place-items-center rounded-xl bg-primary-soft text-primary">
                  <step.icon className="size-5" aria-hidden />
                </span>
                <CardTitle className="text-base">{step.title}</CardTitle>
                <CardDescription>{step.description}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto">
                <Button asChild variant="secondary" size="sm">
                  <Link href={step.href}>
                    {step.action} <ArrowRight />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
