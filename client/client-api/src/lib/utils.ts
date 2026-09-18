export function addDays(date: Date, days: number): Date {
  const out = new Date(date.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

export function startOfDay(date: Date): Date {
  const out = new Date(date.getTime());
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
}

export function slugify(input: string, maxLength = 120): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    // Apostrophes are dropped rather than separated on. "Men's Clothing" came
    // out as `men-s-clothing` — a stray one-letter segment baked into a live
    // storefront address — because the generic rule below treats every
    // non-alphanumeric character as a word boundary. A word interrupted by a
    // quote mark is still one word. Kept ahead of that rule, and matched in
    // `client-admin/src/lib/slugify.ts` so the panel previews what is saved.
    .replace(/['‘’ʼ´`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

/**
 * Must match `company-api/src/lib/utils.ts` exactly — the company side stores
 * the database name but never returns it, so we re-derive it from the slug.
 */
export function tenantDatabaseName(slug: string, prefix: string): string {
  const normalised = slug.replace(/-/g, '_').replace(/[^a-z0-9_]/g, '');
  return `${prefix}${normalised}_db`.slice(0, 63);
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;

/** Guards the value before it is ever interpolated into a database name. */
export function isValidStoreSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !slug.includes('--');
}

/**
 * Extracts the store slug from a request host.
 *   admin.abc-fashion.company.com → abc-fashion
 *   abc-fashion.localhost:3002    → abc-fashion
 */
export function slugFromHost(host: string | undefined, rootDomain: string): string | null {
  if (!host) return null;
  const hostname = host.split(':')[0]!.toLowerCase();

  if (hostname.endsWith(`.${rootDomain}`)) {
    const prefix = hostname.slice(0, -(rootDomain.length + 1));
    const parts = prefix.split('.');
    // `admin.<slug>` or bare `<slug>`
    const candidate = parts.length >= 2 && parts[0] === 'admin' ? parts[1] : parts[parts.length - 1];
    return candidate && isValidStoreSlug(candidate) ? candidate : null;
  }

  if (hostname.endsWith('.localhost')) {
    const prefix = hostname.slice(0, -'.localhost'.length);
    const parts = prefix.split('.');
    const candidate = parts.length >= 2 && parts[0] === 'admin' ? parts[1] : parts[0];
    return candidate && isValidStoreSlug(candidate) ? candidate : null;
  }

  return null;
}

/** Money is a string end to end so it never round-trips through a float. */
export function toMoney(value: number | string | null | undefined): string {
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : (value ?? 0);
  return (Number.isFinite(numeric) ? numeric : 0).toFixed(2);
}

export function moneyToNumber(value: string | number | null | undefined): number {
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : (value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function sumMoney(values: (string | number | null | undefined)[]): string {
  return values.reduce<number>((sum, value) => sum + moneyToNumber(value), 0).toFixed(2);
}

export function multiplyMoney(value: string | number, quantity: number): string {
  return (moneyToNumber(value) * quantity).toFixed(2);
}

export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Only ever write keys that were explicitly allowed — blocks mass assignment. */
export function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Human-facing sequential reference, e.g. ORD-20260809-0042. */
export function sequentialRef(prefix: string, sequence: number, at = new Date()): string {
  const stamp = at.toISOString().slice(0, 10).replace(/-/g, '');
  return `${prefix}-${stamp}-${String(sequence).padStart(4, '0')}`;
}

export function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  if (!domain) return '***';
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(user.length - 2, 1))}@${domain}`;
}
