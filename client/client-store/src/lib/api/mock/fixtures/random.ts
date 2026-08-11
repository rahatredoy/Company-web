/**
 * A seeded pseudo-random generator for fixture data.
 *
 * Deterministic on purpose. `Math.random()` would give a catalogue that changed
 * on every server render: page counts would drift between the listing and its
 * pagination, a product would be in stock in the grid and out of stock on its
 * own page, and no screenshot would ever match the one before it.
 *
 * Seeding from the product slug means each product's numbers are stable, and a
 * product added in the middle of the list does not shift everything after it.
 */

/** xmur3 — turns a string into a well-distributed 32-bit seed. */
function hashSeed(input: string): number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^= h >>> 16) >>> 0;
}

/** mulberry32 — small, fast, good enough for placeholder prices. */
export function seededRandom(seed: string): () => number {
  let a = hashSeed(seed);
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  /** Float in [min, max). */
  float(min: number, max: number): number;
  /** Integer in [min, max]. */
  int(min: number, max: number): number;
  /** True with the given probability. */
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** A stable shuffle, for picking a subset without repeating. */
  sample<T>(items: readonly T[], count: number): T[];
}

export function rngFor(seed: string): Rng {
  const next = seededRandom(seed);

  return {
    float: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    chance: (probability) => next() < probability,
    pick: (items) => items[Math.floor(next() * items.length)]!,
    sample: (items, count) => {
      const pool = [...items];
      for (let i = pool.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [pool[i], pool[j]] = [pool[j]!, pool[i]!];
      }
      return pool.slice(0, Math.min(count, pool.length));
    },
  };
}
