import { Banknote, CreditCard, Smartphone, Wallet, type LucideIcon } from 'lucide-react';
import type { StoreConfig } from '@/types';
import { cn } from '@/lib/utils';

/**
 * "We Accept" — the payment methods this store actually takes.
 *
 * Drawn from the store's configured providers rather than a fixed row of card
 * logos, because showing a Visa mark on a cash-on-delivery-only shop is a
 * promise the checkout then breaks. Cash on delivery in particular is called
 * out in words: it is the most-used method in this market and it has no logo.
 *
 * Icons stand in for brand marks deliberately. Real card-scheme logos are
 * trademarked artwork with usage rules, and they are the store owner's to
 * upload, not this codebase's to ship.
 */

const PROVIDER_ICONS: Record<string, LucideIcon> = {
  cod: Banknote,
  cash_on_delivery: Banknote,
  bkash: Smartphone,
  nagad: Smartphone,
  rocket: Smartphone,
  stripe: CreditCard,
  sslcommerz: CreditCard,
  card: CreditCard,
  paypal: Wallet,
  bank: Banknote,
  bank_transfer: Banknote,
};

const isCashOnDelivery = (provider: string) =>
  provider === 'cod' || provider === 'cash_on_delivery';

export function PaymentBadges({
  payment,
  className,
}: {
  payment: StoreConfig['payment'];
  className?: string;
}) {
  if (payment.providers.length === 0) return null;

  const cash = payment.providers.filter((provider) => isCashOnDelivery(provider.provider));
  const rest = payment.providers.filter((provider) => !isCashOnDelivery(provider.provider));

  return (
    <div className={className}>
      <p className="mb-3 text-sm font-semibold">We Accept</p>

      <ul className="flex flex-wrap items-center gap-2">
        {rest.map((provider) => {
          const Icon = PROVIDER_ICONS[provider.provider] ?? CreditCard;

          return (
            <li
              key={provider.provider}
              title={provider.label}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-[4px] border border-border bg-surface px-2',
                'text-[11px] font-semibold text-muted',
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              <span className="max-w-24 truncate">{provider.label}</span>
            </li>
          );
        })}
      </ul>

      {cash.length > 0 ? (
        <p className="mt-3 text-sm text-muted">{cash[0]!.label}</p>
      ) : null}
    </div>
  );
}
