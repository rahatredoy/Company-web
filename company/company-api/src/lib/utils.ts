import {
  BLOCKED_DOMAIN_SUFFIXES,
  RESERVED_SUBDOMAINS,
  SUBDOMAIN_MAX_LENGTH,
  SUBDOMAIN_MIN_LENGTH,
} from './constants';

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

export function addMonths(date: Date, months: number): Date {
  const out = new Date(date.getTime());
  const day = out.getUTCDate();
  out.setUTCMonth(out.getUTCMonth() + months);
  // Jan 31 + 1 month clamps to the end of February rather than rolling into March.
  if (out.getUTCDate() < day) out.setUTCDate(0);
  return out;
}

export function nextRenewal(from: Date, cycle: 'monthly' | 'yearly'): Date {
  return cycle === 'monthly' ? addMonths(from, 1) : addMonths(from, 12);
}

export function daysRemaining(until: Date | null | undefined): number {
  if (!until) return 0;
  return Math.max(0, Math.ceil((until.getTime() - Date.now()) / 86_400_000));
}

export function startOfDay(date: Date): Date {
  const out = new Date(date.getTime());
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, SUBDOMAIN_MAX_LENGTH)
    .replace(/-+$/g, '');
}

export type SubdomainCheck =
  | { ok: true; value: string }
  | { ok: false; reason: 'invalid' | 'reserved'; message: string };

/** Server-side truth for subdomain shape. Provisioning re-runs this before creating anything. */
export function validateSubdomain(raw: string): SubdomainCheck {
  const value = raw.trim().toLowerCase();

  if (value.length < SUBDOMAIN_MIN_LENGTH || value.length > SUBDOMAIN_MAX_LENGTH) {
    return {
      ok: false,
      reason: 'invalid',
      message: `Use between ${SUBDOMAIN_MIN_LENGTH} and ${SUBDOMAIN_MAX_LENGTH} characters.`,
    };
  }
  if (!/^[a-z0-9-]+$/.test(value)) {
    return { ok: false, reason: 'invalid', message: 'Only lowercase letters, numbers and hyphens are allowed.' };
  }
  if (value.startsWith('-') || value.endsWith('-')) {
    return { ok: false, reason: 'invalid', message: 'Cannot start or end with a hyphen.' };
  }
  if (value.includes('--')) {
    return { ok: false, reason: 'invalid', message: 'Cannot contain two hyphens in a row.' };
  }
  if (/^\d+$/.test(value)) {
    return { ok: false, reason: 'invalid', message: 'Cannot be only numbers.' };
  }
  if ((RESERVED_SUBDOMAINS as readonly string[]).includes(value)) {
    return { ok: false, reason: 'reserved', message: 'This name is reserved by the platform.' };
  }
  return { ok: true, value };
}

const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

export function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

export type DomainCheck = { ok: true; value: string } | { ok: false; reason: 'invalid' | 'blocked'; message: string };

export function validateCustomDomain(raw: string, platformRootDomain: string): DomainCheck {
  const value = normalizeDomain(raw);

  if (value.length > 253 || !DOMAIN_RE.test(value)) {
    return { ok: false, reason: 'invalid', message: 'Enter a valid domain, for example abcfashion.com' };
  }
  if (BLOCKED_DOMAIN_SUFFIXES.some((suffix) => value === suffix.replace(/^\./, '') || value.endsWith(suffix))) {
    return { ok: false, reason: 'blocked', message: 'This domain cannot be used.' };
  }
  // Platform-owned hostnames are issued by provisioning, never claimed by a client.
  if (value === platformRootDomain || value.endsWith(`.${platformRootDomain}`)) {
    return { ok: false, reason: 'blocked', message: 'Platform domains are managed automatically.' };
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    return { ok: false, reason: 'blocked', message: 'IP addresses cannot be used as a domain.' };
  }
  return { ok: true, value };
}

export function buildStorefrontUrl(slug: string, rootDomain: string, customDomain?: string | null): string {
  return customDomain ? `https://${customDomain}` : `https://${slug}.${rootDomain}`;
}

export function buildClientAdminUrl(slug: string, pattern: string): string {
  return pattern.replace('{slug}', slug);
}

export function platformSubdomain(slug: string, rootDomain: string): string {
  return `${slug}.${rootDomain}`;
}

export function formatInvoiceNumber(sequence: number, issuedAt: Date): string {
  return `INV-${issuedAt.getUTCFullYear()}-${String(sequence).padStart(6, '0')}`;
}

/** Tenant database name derived from the slug, e.g. tenant_abc_fashion_db. */
export function tenantDatabaseName(slug: string, prefix: string): string {
  const normalised = slug.replace(/-/g, '_').replace(/[^a-z0-9_]/g, '');
  return `${prefix}${normalised}_db`.slice(0, 63);
}

export function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  if (!domain) return '***';
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(user.length - 2, 1))}@${domain}`;
}

/** Money stays a string end to end; this only adds/rounds for display and totals. */
export function toMoney(value: number | string): string {
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : value;
  return (Number.isFinite(numeric) ? numeric : 0).toFixed(2);
}

export function sumMoney(values: (string | number | null | undefined)[]): string {
  const total = values.reduce<number>((sum, value) => {
    const numeric = typeof value === 'string' ? Number.parseFloat(value) : (value ?? 0);
    return sum + (Number.isFinite(numeric) ? numeric : 0);
  }, 0);
  return total.toFixed(2);
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
