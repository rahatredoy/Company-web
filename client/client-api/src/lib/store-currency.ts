import type { TenantDb } from '../db/tenant-manager';
import { storeSettings } from '../db/schema/index';
import { CACHE_TTL, STOREFRONT_CACHE_SCOPE, cached, tenantKey } from './cache';
import { resolveLanguage, type Language } from './languages';
import { logger } from './logger';
import { redis } from './redis';

interface StoreLocale {
  currency: string;
  language: Language;
}

type StoreHandle = {
  tenantRef: string;
  currency: string;
  language: string;
  db: TenantDb;
};

/**
 * The currency this store trades in — `store_settings.currency`, and nothing else.
 *
 * **This is the one reader, for both halves of the API.** The tenant record the
 * control plane publishes carries a `currency` too, but that is the value
 * provisioning started the store with and nothing ever moves it; the owner's
 * choice lives in the tenant database. The admin session used to report the
 * control plane's copy, so a shop switched to BDT on its Settings screen went
 * on showing dollars on every other screen of its own panel while the
 * storefront had already moved. Every surface asking here is what keeps the
 * panel, the storefront and the till on one answer.
 *
 * Every storefront read accepts a `?currency=` parameter — it is part of the
 * Next.js cache key, so a shared cache entry can never serve one visitor's
 * currency to the next — but the value is **not** honoured, and that is
 * deliberate rather than unfinished. Converting would mean holding exchange
 * rates and deciding when they are stale, and a price is what the customer is
 * charged; quoting one at yesterday's rate is a pricing bug, not a display one.
 * `store_settings.preferences.currencies` therefore holds the single currency the
 * store trades in, and the storefront draws no selector when there is only one.
 */
export async function loadStoreCurrency(store: StoreHandle): Promise<string> {
  return (await loadStoreLocale(store)).currency;
}

/**
 * The language this store runs in — `store_settings.language`, for the same
 * reason and with the same bug avoided as the currency above: the tenant record's
 * `language` is what provisioning started the store with, and a panel reading it
 * would stay in English after the owner switched Settings to বাংলা.
 *
 * It is what the panel is drawn in, what this API writes its error messages in
 * (`plugins/error-handler.ts`), and what the storefront defaults a visitor to.
 * Always a supported language: a stored code with no dictionary resolves to
 * English rather than to a screen that is half one thing and half the other.
 */
export async function loadStoreLanguage(store: StoreHandle): Promise<Language> {
  return (await loadStoreLocale(store)).language;
}

/*
 * Both are read together, from one row, into one cache entry. They live on the
 * same row, move on the same save, and the session needs both — two keys would
 * be two round trips for no gain.
 */
async function loadStoreLocale(store: StoreHandle): Promise<StoreLocale> {
  /*
   * Held in this process for a few seconds as well as in Redis.
   *
   * Every catalogue read needs the currency before it can do anything else — it
   * is part of the cache key, so it cannot be fetched alongside the listing it
   * keys — which made it a serial round trip to a Redis that is not local, on
   * the front of every product page in the platform. It changes only when the
   * owner saves a different one on the Settings screen, and that save calls
   * `forgetStoreLocale` on its way out, so the process that took the write
   * answers with the new value at once and any other instance within
   * `LOCALE_MEMO_MS`.
   */
  const memo = localeMemo.get(store.tenantRef);
  if (memo && memo.expiresAt > Date.now()) return memo.locale;

  const locale = await cached(localeKey(store.tenantRef), CACHE_TTL.storefrontConfig, async () => {
    const [row] = await store.db
      .select({ currency: storeSettings.currency, language: storeSettings.language })
      .from(storeSettings)
      .limit(1);
    // The control plane's values are the fallback: they are what provisioning
    // wrote into `store_settings` in the first place.
    return {
      currency: row?.currency ?? store.currency,
      language: resolveLanguage(row?.language ?? store.language),
    } satisfies StoreLocale;
  });

  localeMemo.set(store.tenantRef, { locale, expiresAt: Date.now() + LOCALE_MEMO_MS });
  return locale;
}

/**
 * Drops both copies, before the response to the save is sent.
 *
 * `invalidateStorefrontOnWrite` would drop the Redis copy too, but it runs in
 * `onResponse` — after the reply — and the panel calls `router.refresh()` the
 * moment the save answers. That refresh reads the session, and a session read
 * that won the race against the hook would render the whole panel in the old
 * currency, or the old language, straight after the owner was told the new one
 * had saved.
 */
export async function forgetStoreLocale(tenantRef: string): Promise<void> {
  localeMemo.delete(tenantRef);
  try {
    await redis.del(localeKey(tenantRef));
  } catch (error) {
    // The TTL is the backstop; a failed delete costs staleness, not correctness.
    logger.warn({ err: (error as Error).message, tenantRef }, 'store locale cache delete failed');
  }
}

const localeKey = (tenantRef: string) => tenantKey(tenantRef, STOREFRONT_CACHE_SCOPE, 'locale');

const localeMemo = new Map<string, { locale: StoreLocale; expiresAt: number }>();
const LOCALE_MEMO_MS = 5_000;
