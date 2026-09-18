import 'server-only';
import { cache } from 'react';
import type { CmsPage, Faq } from '@/types';
import { cookieHeader, storeCall } from '@/lib/tenant';
import { apiFetch } from './client';

/**
 * Editorial content: CMS pages, policies, FAQs, and the one form that writes
 * back — contact.
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
  return apiFetch<CmsPage | null>(`/api/v1/storefront/pages/${encodeURIComponent(slug)}`, {
    ...(await storeCall()),
    revalidate: 300,
    tags: ['pages', `page:${slug}`],
    // A missing page is a 404 to render, not an error to throw.
    allowNotFound: true,
  });
});

export const getFaqs = cache(async (): Promise<Faq[]> => {
  return apiFetch<Faq[]>('/api/v1/storefront/faqs', {
    ...(await storeCall()),
    revalidate: 300,
    tags: ['faqs'],
  });
});

export async function submitContactMessage(input: ContactInput): Promise<void> {
  await apiFetch<unknown>('/api/v1/storefront/contact', {
    method: 'POST',
    body: input,
    ...(await storeCall()),
    cookieHeader: await cookieHeader(),
  });
}
