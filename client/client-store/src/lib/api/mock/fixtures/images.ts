/**
 * Placeholder imagery for the fixture layer.
 *
 * Remote URLs rather than committed binaries, which keeps the repository small
 * and — more usefully — exercises the real `next/image` remote-loading path,
 * including the `remotePatterns` allow-list and the AVIF/WebP pipeline. A local
 * `/public` image would test none of that.
 *
 * The seed is part of the URL, so the same product gets the same photograph on
 * every render and between deploys. Random placeholders would make every
 * screenshot and every visual comparison worthless.
 */

const HOST = 'https://picsum.photos/seed';

export function img(seed: string, width = 800, height = 800): string {
  return `${HOST}/${encodeURIComponent(seed)}/${width}/${height}`;
}

/**
 * A small pool of photograph seeds, shared across the catalogue.
 *
 * One unique seed per product meant 150 distinct upstream images, and a
 * homepage that asks for sixty of them at once gets rate-limited — which showed
 * up as product cards with empty media, looking exactly like a broken image
 * pipeline rather than a throttled placeholder service.
 *
 * Drawing from a fixed pool means the whole catalogue resolves to ~40 upstream
 * requests, each cached by the image optimiser after the first hit. Products
 * repeat photographs, which is obvious and fine in placeholder data.
 */
const POOL_SIZE = 40;

function poolIndex(key: string, offset: number): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (Math.abs(hash) + offset) % POOL_SIZE;
}

/** Stable per key, so a product keeps its photograph between renders. */
export function pooledImage(key: string, width: number, height: number, offset = 0): string {
  return img(`ph-${poolIndex(key, offset)}`, width, height);
}

/** 1:1 — marketplace and electronics product cards. */
export const imgSquare = (seed: string) => img(seed, 800, 800);

/** 4:5 — fashion and minimal product cards. */
export const imgPortrait = (seed: string) => img(seed, 800, 1000);

/** 16:9 — banners and lifestyle cards. */
export const imgWide = (seed: string) => img(seed, 1200, 675);

/** Editorial hero photography. */
export const imgHero = (seed: string) => img(seed, 1400, 900);

export const imgAvatar = (seed: string) => img(seed, 96, 96);
