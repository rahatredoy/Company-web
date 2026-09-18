/**
 * Every configured address, upgraded to `https://` unless it is loopback.
 *
 * A misconfigured `NEXT_PUBLIC_*` is the one way plaintext gets back into a
 * platform that is otherwise HTTPS end to end, and it is a quiet one: an
 * `http://` API address does not fail, it just means every request this app
 * makes — session cookie included — is readable and rewritable by anyone on the
 * path. The browser would block most of them as mixed content on an https page,
 * which turns a security mistake into a baffling outage instead of a warning.
 *
 * So the scheme is not taken on trust from the environment. Loopback is the one
 * exception and has to be: the six apps talk to each other over
 * `http://localhost` on six ports in development, and there is no network
 * between them.
 *
 * Applied to **patterns** as well as fixed addresses — `http://{slug}.localhost`
 * is loopback and left alone, `http://api.{slug}.company.com` is not and is
 * upgraded.
 */
function secure(value: string): string {
  if (!value.startsWith('http://')) return value;

  const rest = value.slice('http://'.length);
  const hostname = rest.split('/')[0]!.split(':')[0]!.toLowerCase();
  const loopback =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0';

  return loopback ? value : `https://${rest}`;
}

/**
 * Public runtime values. Everything here is compiled into the browser bundle,
 * so nothing secret may ever be added to this file.
 */
export const publicEnv = {
  apiUrl: secure(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'),
  platformName: process.env.NEXT_PUBLIC_PLATFORM_NAME ?? 'ShopSaaS',
  websiteUrl: secure(process.env.NEXT_PUBLIC_WEBSITE_URL ?? 'http://localhost:3000'),
} as const;
