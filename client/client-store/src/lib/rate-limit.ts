import 'server-only';

/**
 * A small in-process rate limiter for this app's own route handlers.
 *
 * Deliberately not a security boundary. The Commerce API does the real limiting
 * — it has Redis, it sees every instance's traffic, and it is the thing holding
 * the data. This exists so a form that anyone can POST to cannot be used to
 * hammer the API from a single machine, and so an obviously abusive client gets
 * a 429 from the edge of this app rather than a queue of upstream requests.
 *
 * In-memory means the budget is per instance, and a restart forgives everyone.
 * Both are acceptable for that job and neither would be for authentication.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Stops the map growing without bound on a long-lived server. */
const MAX_TRACKED = 5_000;

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the caller may try again. Only meaningful when `ok` is false. */
  retryAfter: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_TRACKED) sweep(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return { ok: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
  }

  return { ok: true, retryAfter: 0 };
}

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Still full of live buckets: drop the oldest rather than refuse to track.
  if (buckets.size >= MAX_TRACKED) {
    const oldest = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (const [key] of oldest.slice(0, Math.floor(MAX_TRACKED / 4))) buckets.delete(key);
  }
}

/**
 * Best-effort client address.
 *
 * `X-Forwarded-For` is trivially spoofable when nothing trusted sets it, which
 * is the other reason this limiter is not a security control — it groups honest
 * traffic, it does not stop a determined one.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim().slice(0, 64);
  return request.headers.get('x-real-ip')?.slice(0, 64) ?? 'unknown';
}
