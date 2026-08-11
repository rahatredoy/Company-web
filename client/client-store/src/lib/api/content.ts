import 'server-only';
import { cache } from 'react';
import { isMockData } from '@/config';
import type { CmsPage, Faq } from '@/types';
import { cookieHeader, storeCall } from '@/lib/tenant';
import { apiFetch } from './client';

/**
 * Editorial content: CMS pages, policies, FAQs, and the two forms that write
 * back — newsletter and contact.
 *
 * The reads are identical for every visitor and carry a revalidation window.
 * The writes deliberately do not: a submission must reach the API every time.
 */

export interface ContactInput {
  name: string;
  email: string;
  phone?: string;
  subject: string;
  message: string;
}

export const getCmsPage = cache(async (slug: string): Promise<CmsPage | null> => {
  if (isMockData) {
    const { mockCmsPage } = await import('./mock/content');
    return mockCmsPage(slug);
  }

  return apiFetch<CmsPage | null>(`/api/v1/storefront/pages/${encodeURIComponent(slug)}`, {
    ...(await storeCall()),
    revalidate: 300,
    tags: ['pages', `page:${slug}`],
    // A missing page is a 404 to render, not an error to throw.
    allowNotFound: true,
  });
});

export const getFaqs = cache(async (): Promise<Faq[]> => {
  if (isMockData) {
    const { mockFaqs } = await import('./mock/content');
    return mockFaqs();
  }

  return apiFetch<Faq[]>('/api/v1/storefront/faqs', {
    ...(await storeCall()),
    revalidate: 300,
    tags: ['faqs'],
  });
});

/**
 * Newsletter sign-up.
 *
 * Resolves for both a new subscriber and one who is already on the list. The
 * caller must not be able to tell the two apart — a subscribe box that reports
 * "this address is already registered" is a free account-enumeration oracle for
 * anyone with a word list.
 */
export async function subscribeNewsletter(email: string): Promise<void> {
  if (isMockData) {
    const { mockSubscribeNewsletter } = await import('./mock/content');
    return mockSubscribeNewsletter(email);
  }

  await apiFetch<unknown>('/api/v1/storefront/newsletter', {
    method: 'POST',
    body: { email },
    ...(await storeCall()),
    cookieHeader: await cookieHeader(),
  });
}

export async function submitContactMessage(input: ContactInput): Promise<void> {
  if (isMockData) {
    const { mockSubmitContactMessage } = await import('./mock/content');
    return mockSubmitContactMessage(input);
  }

  await apiFetch<unknown>('/api/v1/storefront/contact', {
    method: 'POST',
    body: input,
    ...(await storeCall()),
    cookieHeader: await cookieHeader(),
  });
}
