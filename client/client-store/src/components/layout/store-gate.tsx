import Link from 'next/link';
import { Clock, Store } from 'lucide-react';
import type { StoreConfig } from '@/types';

/**
 * Decides whether a store is open for business.
 *
 * `StoreConfig.status` is the platform's verdict on the account behind this
 * shopfront, and until this component existed nothing read it — a suspended
 * store rendered a full catalogue with a working add-to-cart. The API refuses
 * the orders regardless, so the damage was a customer filling a basket they
 * could never check out, which is a worse experience than being told plainly.
 *
 * The wording is deliberately neutral. Why a store is closed is between the
 * platform and the merchant; a shopper does not need to know that a payment
 * bounced, and saying so publicly would leak the merchant's billing state to
 * anyone who loads the page.
 */

type Status = StoreConfig['status'];

/** The two statuses that mean "trading". Everything else stops at the door. */
const TRADING: Status[] = ['active', 'trial'];

/** Being built. This one is temporary and worth saying so. */
const PROVISIONING: Status[] = ['pending', 'provisioning'];

export function isStoreTrading(status: Status): boolean {
  return TRADING.includes(status);
}

export function StoreGate({
  config,
  children,
}: {
  config: StoreConfig;
  children: React.ReactNode;
}) {
  if (isStoreTrading(config.status)) return <>{children}</>;

  const building = PROVISIONING.includes(config.status);

  return (
    <main id="main" className="grid min-h-[80vh] place-items-center px-4 py-16">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto mb-6 grid size-14 place-items-center rounded-full bg-primary-soft text-primary">
          {building ? <Clock className="size-6" /> : <Store className="size-6" />}
        </span>

        <h1 className="text-2xl font-semibold">{config.store.name}</h1>

        <p className="mt-3 text-muted">
          {building
            ? 'This store is being set up and will open shortly. Please check back soon.'
            : 'This store is temporarily unavailable.'}
        </p>

        {/* The only thing a visitor can usefully do is get in touch. */}
        {config.contact.email || config.contact.phone ? (
          <div className="mt-8 rounded-(--radius-card) border border-border bg-surface p-5 text-sm">
            <p className="font-medium">Need to reach us?</p>
            <ul className="mt-2 space-y-1 text-muted">
              {config.contact.email ? (
                <li>
                  <Link href={`mailto:${config.contact.email}`} className="hover:text-primary">
                    {config.contact.email}
                  </Link>
                </li>
              ) : null}
              {config.contact.phone ? (
                <li>
                  <Link href={`tel:${config.contact.phone}`} className="hover:text-primary">
                    {config.contact.phone}
                  </Link>
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </div>
    </main>
  );
}
