import 'server-only';
import type { PaymentMethodOption, StoreConfig } from '@/types';

/**
 * Payment methods the store has actually switched on.
 *
 * Derived from store configuration rather than fetched separately — the
 * providers are already in `StoreConfig`, and a second source would eventually
 * disagree with the "We accept" row in the footer.
 */
export function paymentMethodsFrom(config: StoreConfig): PaymentMethodOption[] {
  const INSTRUCTIONS: Record<string, string> = {
    cod: 'Pay in cash when your order arrives. Please have the exact amount ready.',
    bkash: 'You will be taken to bKash to authorise the payment.',
    nagad: 'You will be taken to Nagad to authorise the payment.',
    card: 'You will be taken to our payment provider. Your card details never touch this site.',
  };

  return config.payment.providers.map((provider) => ({
    provider: provider.provider,
    label: provider.label,
    description: provider.description,
    instructions: INSTRUCTIONS[provider.provider] ?? null,
  }));
}
