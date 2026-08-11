import { ChevronRight, CreditCard, Package, Palette, Truck, type LucideIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const STEPS: { title: string; description: string; icon: LucideIcon; tint: string }[] = [
  {
    title: 'Add products',
    description: 'Add your first product to your store.',
    icon: Package,
    tint: 'bg-primary-soft text-primary',
  },
  {
    title: 'Configure payment',
    description: 'Set up payment methods to receive payments.',
    icon: CreditCard,
    tint: 'bg-info-soft text-info',
  },
  {
    title: 'Configure shipping',
    description: 'Set up shipping zones and delivery options.',
    icon: Truck,
    tint: 'bg-warning-soft text-warning',
  },
  {
    title: 'Customize store',
    description: 'Make your store look great with our themes.',
    icon: Palette,
    tint: 'bg-success-soft text-success',
  },
];

/**
 * What is left to do once the store exists — all of it inside the owner's own
 * admin panel, so every tile leads there rather than to a page here.
 *
 * Products, payments, shipping and design belong to `client-admin` and must
 * never be managed from this dashboard; these are signposts, not settings. They
 * all open the panel's home because the panel owns its own navigation.
 */
export function StoreNextSteps({ adminUrl }: { adminUrl: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What&apos;s next?</CardTitle>
        <CardDescription>Follow these steps to start selling.</CardDescription>
      </CardHeader>

      <CardContent>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {STEPS.map((step) => (
            <li key={step.title}>
              <a
                href={adminUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="flex h-full items-center gap-3 rounded-xl border border-border p-4 transition-colors hover:border-border-strong hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
              >
                <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', step.tint)}>
                  <step.icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{step.title}</span>
                  <span className="block text-xs leading-relaxed text-muted-foreground">
                    {step.description}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
