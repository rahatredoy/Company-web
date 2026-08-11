import { Resolver } from 'node:dns/promises';
import { config } from '../config/index';
import { logger } from './logger';

/**
 * A dedicated resolver with a short timeout — domain verification must never
 * hold a request open waiting on a slow nameserver.
 */
const resolver = new Resolver({ timeout: 4_000, tries: 2 });

export interface DnsRecordInstruction {
  type: 'CNAME' | 'TXT' | 'A';
  name: string;
  value: string;
  ttl: string;
}

/** The exact records a client must publish for a custom domain. */
export function dnsInstructions(domain: string, verificationToken: string): DnsRecordInstruction[] {
  const isApex = domain.split('.').length === 2;
  return [
    {
      type: 'TXT',
      name: `_platform-verify.${domain}`,
      value: verificationToken,
      ttl: '300',
    },
    {
      type: isApex ? 'A' : 'CNAME',
      name: isApex ? '@' : domain.split('.')[0]!,
      value: config.urls.dnsTarget,
      ttl: '3600',
    },
  ];
}

export interface DnsCheckResult {
  ownershipVerified: boolean;
  pointsToPlatform: boolean;
  error: string | null;
}

/**
 * Two independent checks:
 *  - a TXT record proves the client controls the domain;
 *  - a CNAME/A record shows traffic will actually reach us.
 * A domain is only activated when the ownership proof passes.
 */
export async function checkDomain(domain: string, verificationToken: string): Promise<DnsCheckResult> {
  let ownershipVerified = false;
  let pointsToPlatform = false;
  let error: string | null = null;

  try {
    const records = await resolver.resolveTxt(`_platform-verify.${domain}`);
    ownershipVerified = records.some((chunks) => chunks.join('').trim() === verificationToken);
  } catch (dnsError) {
    error = `TXT lookup failed: ${(dnsError as NodeJS.ErrnoException).code ?? 'unknown'}`;
  }

  try {
    const cnames = await resolver.resolveCname(domain).catch(() => [] as string[]);
    pointsToPlatform = cnames.some((value) => value.replace(/\.$/, '') === config.urls.dnsTarget);

    if (!pointsToPlatform) {
      const [target, actual] = await Promise.all([
        resolver.resolve4(config.urls.dnsTarget).catch(() => [] as string[]),
        resolver.resolve4(domain).catch(() => [] as string[]),
      ]);
      pointsToPlatform = target.length > 0 && actual.some((ip) => target.includes(ip));
    }
  } catch (dnsError) {
    logger.debug({ domain, err: (dnsError as Error).message }, 'domain target lookup failed');
  }

  return { ownershipVerified, pointsToPlatform, error };
}
