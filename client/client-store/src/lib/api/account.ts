import 'server-only';
import { cache } from 'react';
import type { Address, Customer, ReturnSummary } from '@/types';
import { cookieHeader, storeCall } from '@/lib/tenant';
import { apiFetch } from './client';

/**
 * The signed-in customer.
 *
 * Every call here is visitor-specific: never cached, always forwarding the
 * session cookie. The public catalogue reads live in a separate module with the
 * opposite defaults precisely so the two cannot be confused.
 *
 * The cookie name matches what `client-api` reserves for a shopper session
 * (`store_customer_session`), so when the real endpoints land the storefront is
 * already sending what they expect.
 */

export const CUSTOMER_SESSION_COOKIE = 'store_customer_session';
export const CUSTOMER_SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * The current customer, or null.
 *
 * Returns null rather than throwing on an expired or forged session, because
 * "not signed in" is a state every page has to render — turning it into an
 * exception means every caller writes the same try/catch.
 */
export const getCustomer = cache(async (): Promise<Customer | null> => {

  return apiFetch<Customer | null>('/api/v1/storefront/account/me', {
    ...(await storeCall()),
    cookieHeader: await cookieHeader(),
    // An unauthenticated read is a fact, not a failure — same reasoning as the
    // `GET /session` endpoints on the admin side.
    allowNotFound: true,
  });
});

export async function getAddresses(): Promise<Address[]> {

  return apiFetch<Address[]>('/api/v1/storefront/account/addresses', {
    ...(await storeCall()),
    cookieHeader: await cookieHeader(),
  });
}

export async function getReturns(): Promise<ReturnSummary[]> {

  return apiFetch<ReturnSummary[]>('/api/v1/storefront/account/returns', {
    ...(await storeCall()),
    cookieHeader: await cookieHeader(),
  });
}

export async function updateCustomer(
  patch: Partial<Pick<Customer, 'fullName' | 'phone' | 'acceptsMarketing'>>,
): Promise<Customer | null> {

  return apiFetch<Customer>('/api/v1/storefront/account/me', {
    method: 'PUT',
    body: patch,
    ...(await storeCall()),
    cookieHeader: await cookieHeader(),
  });
}
