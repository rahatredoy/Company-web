import {
  BadgeCheck,
  Gift,
  Headphones,
  Package,
  RotateCcw,
  ShieldCheck,
  Tag,
  Truck,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { TemplatePreset } from '@/templates/meta';
import type { BenefitItem } from '@/sections/parse';
import { cn } from '@/lib/utils';

/**
 * The four-up trust strip: free shipping, returns, secure payment, support.
 *
 * Renders only the claims the store has actually configured. Defaulting to a
 * full set of four would put "Free Shipping" on a shopfront that charges for
 * delivery, which is a promise the checkout would then break.
 */

const ICONS: Record<string, LucideIcon> = {
  truck: Truck,
  package: Package,
  'rotate-ccw': RotateCcw,
  'shield-check': ShieldCheck,
  headphones: Headphones,
  wallet: Wallet,
  tag: Tag,
  gift: Gift,
  'badge-check': BadgeCheck,
};

export function BenefitsStrip({
  items,
  tone = 'tinted',
  className,
}: {
  items: BenefitItem[];
  tone?: TemplatePreset['benefitsTone'];
  className?: string;
}) {
  if (items.length === 0) return null;

  const dark = tone === 'dark';

  return (
    <ul
      className={cn(
        'grid gap-4 sm:grid-cols-2 lg:grid-cols-4',
        tone === 'tinted' && 'rounded-(--radius-card) bg-primary-soft p-5 sm:p-6',
        tone === 'bordered' &&
          'divide-y divide-border rounded-(--radius-card) border border-border bg-surface p-5 sm:divide-x sm:divide-y-0 sm:p-0',
        tone === 'dark' && 'rounded-(--radius-card) bg-secondary p-5 text-secondary-foreground sm:p-6',
        tone === 'plain' && 'py-2',
        className,
      )}
    >
      {items.slice(0, 4).map((item, index) => {
        const Icon = ICONS[item.icon] ?? ShieldCheck;

        return (
          <li
            key={`${item.title}-${index}`}
            className={cn(
              'flex items-center gap-3',
              tone === 'bordered' && 'px-1 py-4 sm:px-5 sm:py-6',
            )}
          >
            <span
              className={cn(
                'grid size-11 shrink-0 place-items-center rounded-full',
                dark ? 'bg-white/12 text-secondary-foreground' : 'bg-surface text-primary',
                tone === 'plain' && 'bg-primary-soft',
              )}
            >
              <Icon className="size-5" aria-hidden />
            </span>

            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-snug">{item.title}</span>
              {item.description ? (
                <span className={cn('block text-xs', dark ? 'opacity-75' : 'text-muted')}>
                  {item.description}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
