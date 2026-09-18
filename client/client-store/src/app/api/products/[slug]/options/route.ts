import { NextResponse } from 'next/server';
import type { ProductDetail } from '@/types';

/**
 * The options a card's Add button needs before it can add anything.
 *
 * A product sold in sizes — 1 kg, 500 g, 250 g — has no single price and no
 * single stock level, so "add this to my basket" is not yet a complete
 * instruction. The picker behind the card's Add button asks this for the list,
 * and the shopper's choice is what completes it.
 *
 * A route handler rather than a Server Action, for the reason
 * `api/search/suggest` is one: this fires from a control the shopper can close
 * again immediately, so it wants to be cancellable with an `AbortController`,
 * and its answer is public and worth an HTTP cache. Actions are neither.
 *
 * It is a **narrowing proxy**, not a passthrough. The product detail behind it
 * also carries the description, the specifications and the review summary —
 * several kilobytes a picker never draws — so only the fields the picker
 * renders are copied out. Nothing here is a second way to read the catalogue:
 * the upstream call is the same published-only endpoint the product page uses,
 * and an unpublished product 404s there before it reaches this.
 */
export interface QuickAddOptions {
  id: string;
  slug: string;
  name: string;
  currency: string;
  imageUrl: string | null;
  minOrderQuantity: number;
  maxOrderQuantity: number | null;
  defaultVariantId: string | null;
  options: ProductDetail['options'];
  /*
   * The variants whole, not trimmed to what the picker reads today. They are
   * what `VariantSelector` takes — the same component the product page uses,
   * with the same rules about which combinations exist and which are in stock —
   * and a narrower copy here would mean a second implementation of those rules
   * that could disagree with the first.
   */
  variants: ProductDetail['variants'];
}

/**
 * The visitor's translator, for the error messages below — imported on demand,
 * like the rest of the data layer this handler reaches, and only on the paths
 * that have something to say.
 */
async function translator() {
  const { getT } = await import('@/lib/i18n/server');
  return getT();
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await params;

  const { apiFetch } = await import('@/lib/api/client');
  const { storeCall } = await import('@/lib/tenant');

  try {
    const product = await apiFetch<ProductDetail | null>(
      `/api/v1/storefront/products/${encodeURIComponent(slug)}`,
      {
        ...(await storeCall()),
        // No cookie is forwarded and none is set, so this may be shared. Held
        // as briefly as the listing behind it: it carries prices and stock.
        revalidate: 60,
        tags: ['products'],
        allowNotFound: true,
      },
    );

    if (!product) {
      const t = await translator();
      return NextResponse.json({ error: t('That product is no longer available.') }, { status: 404 });
    }

    const payload: QuickAddOptions = {
      id: product.id,
      slug: product.slug,
      name: product.name,
      currency: product.currency,
      imageUrl: product.images[0]?.url ?? null,
      minOrderQuantity: product.minOrderQuantity,
      maxOrderQuantity: product.maxOrderQuantity,
      defaultVariantId: product.defaultVariantId,
      options: product.options,
      variants: product.variants,
    };

    return NextResponse.json({ data: payload });
  } catch (error) {
    // The picker falls back to sending the shopper to the product page, which
    // can answer the same question with the whole screen to do it in.
    console.error('[storefront] quick-add options failed', error);
    const t = await translator();
    return NextResponse.json({ error: t('We could not load the options.') }, { status: 502 });
  }
}
