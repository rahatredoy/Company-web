import { NextResponse } from 'next/server';
import { isMockData } from '@/config';
import type { SearchSuggestion } from '@/types';

/**
 * Search autocomplete.
 *
 * A route handler rather than a Server Action: this fires while someone types,
 * needs to be cancellable with `AbortController`, and benefits from an HTTP
 * cache — none of which an action gives you.
 *
 * Short queries return nothing at all. One or two characters match most of a
 * catalogue, so the suggestions are useless and the query is expensive — the
 * debounce in the input is the first defence and this is the second.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const term = new URL(request.url).searchParams.get('q')?.trim() ?? '';

  if (term.length < 2) return NextResponse.json({ data: [] });

  try {
    if (isMockData) {
      const { mockSearchSuggestions } = await import('@/lib/api/mock/product');
      const data = await mockSearchSuggestions(term.slice(0, 80));
      return NextResponse.json(
        { data },
        // Brief, shared, and safe: suggestions are identical for every visitor.
        { headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=120' } },
      );
    }

    const { apiFetch } = await import('@/lib/api/client');
    const { storeCall } = await import('@/lib/tenant');

    const data = await apiFetch<SearchSuggestion[]>('/api/v1/storefront/search/suggest', {
      ...(await storeCall()),
      query: { q: term.slice(0, 80) },
      revalidate: 30,
      tags: ['search'],
    });

    return NextResponse.json({ data });
  } catch (error) {
    // A failed suggestion lookup must never break typing. The input falls back
    // to plain submission, which still reaches the real results page.
    console.error('[storefront] search suggest failed', error);
    return NextResponse.json({ data: [] });
  }
}
