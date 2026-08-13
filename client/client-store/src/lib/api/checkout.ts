import 'server-only';
import { isMockCommerce } from '@/config';
import type { PaymentMethodOption, ShippingMethodOption, StoreConfig } from '@/types';
import { storeCall } from '@/lib/tenant';
import { apiFetch } from './client';

/**
 * Checkout options.
 *
 * Shipping methods and their prices come from the server and are never derived
 * here: which couriers serve an address, what they charge, and whether a
 * threshold makes it free are commercial rules that live in one place.
 */

export interface DeliveryTarget {
  city?: string;
  country?: string;
  postalCode?: string;
}

export async function getShippingMethods(target: DeliveryTarget): Promise<ShippingMethodOption[]> {
  if (isMockCommerce) {
    const { mockShippingMethods } = await import('./mock/checkout');
    return mockShippingMethods(target);
  }

  return apiFetch<ShippingMethodOption[]>('/api/v1/storefront/checkout/shipping-methods', {
    ...(await storeCall()),
    query: { ...target },
  });
}

/**
 * Payment methods the store has actually switched on.
 *
 * Derived from store configuration rather than fetched separately — the
 * providers are already in `StoreConfig`, and a second source would eventually
 * disagree with the "We accept" row in the footer.
 */
export function paymentMethodsFrom(config: StoreConfig): PaymentMethodOption[] {
  const INSTRUCTIONS: Record<string, string> = {
    cod: 'Pay the courier in cash when your order arrives. Please have the exact amount ready.',
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
