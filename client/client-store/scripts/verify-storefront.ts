/**
 * Storefront verification.
 *
 * There is no test runner in this repository — correctness is checked by `tsx`
 * scripts that hit a running app, the same convention as
 * `client-api/scripts/verify-slice0.ts`.
 *
 * Two passes:
 *
 * 1. **Routes.** Every page, checked for the status it should return, for the
 *    absence of a React error overlay, for exactly one `<h1>`, and for every
 *    `<img>` having an `alt` attribute.
 * 2. **The design matrix.** All 6 templates × 8 colour themes on the homepage,
 *    asserting the served HTML actually carries the requested theme and the
 *    template's body class. That is the property the whole design system rests
 *    on, and it is the one a refactor is most likely to break silently.
 *
 * Uses `node:http` rather than `fetch` on purpose — the same reason
 * `verify-slice0.ts` does. `fetch` drops a custom `Host` header, and the
 * hostname is the entire tenant-identity mechanism on this side.
 *
 * Usage:
 *   npm run dev            # in another terminal
 *   npx tsx scripts/verify-storefront.ts
 *   npx tsx scripts/verify-storefront.ts --host abc-fashion.localhost
 */

import http from 'node:http';

const args = process.argv.slice(2);
const readArg = (name: string, fallback: string) => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] ? args[index + 1]! : fallback;
};

const PORT = Number.parseInt(readArg('port', '3003'), 10);
const HOST_HEADER = readArg('host', `localhost:${PORT}`);

const TEMPLATES = [
  'marketplace',
  'modern_shop',
  'fashion_boutique',
  'minimal_store',
  'electronics',
  'lifestyle',
] as const;

const THEMES = [
  'royal_blue',
  'emerald_green',
  'luxury_black',
  'rose_pink',
  'modern_purple',
  'sunset_orange',
  'midnight_navy',
  'olive_premium',
] as const;

/** Which body class each template sets, so the assertion is specific. */
const BODY_CLASS: Record<string, string> = {
  marketplace: 'template-dense',
  modern_shop: 'template-soft',
  fashion_boutique: 'template-editorial',
  minimal_store: 'template-editorial',
  electronics: 'template-technical',
  lifestyle: 'template-soft',
};

interface Result {
  status: number;
  body: string;
  location: string | null;
}

function request(path: string): Promise<Result> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path,
        method: 'GET',
        // The whole point of `node:http` here: this header survives.
        headers: { Host: HOST_HEADER, Accept: 'text/html' },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body,
            location: (res.headers.location as string | undefined) ?? null,
          }),
        );
      },
    );

    req.on('error', reject);
    req.setTimeout(45_000, () => req.destroy(new Error(`Timed out requesting ${path}`)));
    req.end();
  });
}

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Structural assertions every rendered page must satisfy. */
function checkHtml(label: string, body: string) {
  check(
    `${label}: no error overlay`,
    !/Application error|Unhandled Runtime Error|__next_error__/.test(body),
    'page rendered an error',
  );

  const h1Count = (body.match(/<h1[\s>]/g) ?? []).length;
  check(`${label}: exactly one <h1>`, h1Count === 1, `found ${h1Count}`);

  const imagesWithoutAlt = (body.match(/<img\b(?![^>]*\balt=)[^>]*>/g) ?? []).length;
  check(`${label}: every <img> has alt`, imagesWithoutAlt === 0, `${imagesWithoutAlt} without alt`);
}

const PAGES: { path: string; expect: number; skipHtmlChecks?: boolean }[] = [
  { path: '/', expect: 200 },
  { path: '/shop', expect: 200 },
  { path: '/search?q=dress', expect: 200 },
  { path: '/categories', expect: 200 },
  { path: '/category/womens-fashion', expect: 200 },
  { path: '/category/dresses', expect: 200 },
  { path: '/brands', expect: 200 },
  { path: '/brand/zara', expect: 200 },
  { path: '/product/floral-summer-dress', expect: 200 },
  { path: '/new-arrivals', expect: 200 },
  { path: '/best-sellers', expect: 200 },
  { path: '/sale', expect: 200 },
  { path: '/featured', expect: 200 },
  { path: '/cart', expect: 200 },
  { path: '/checkout', expect: 200 },
  { path: '/checkout/failure', expect: 200 },
  { path: '/wishlist', expect: 200 },
  { path: '/compare', expect: 200 },
  { path: '/track-order', expect: 200 },
  { path: '/contact', expect: 200 },
  { path: '/faq', expect: 200 },
  { path: '/page/privacy', expect: 200 },
  { path: '/page/terms', expect: 200 },
  { path: '/page/return-policy', expect: 200 },
  { path: '/page/shipping-policy', expect: 200 },
  { path: '/login', expect: 200 },
  { path: '/register', expect: 200 },
  { path: '/forgot-password', expect: 200 },
  { path: '/reset-password', expect: 200 },
  { path: '/verify-email', expect: 200 },
  { path: '/no-such-page-exists', expect: 404 },
  // XML and text documents have no `<h1>` or `<img>` to check.
  { path: '/sitemap.xml', expect: 200, skipHtmlChecks: true },
  { path: '/robots.txt', expect: 200, skipHtmlChecks: true },
];

/** Bare policy paths and the legacy tracking path must redirect, not 404. */
const REDIRECTS: { path: string; to: string }[] = [
  { path: '/privacy', to: '/page/privacy' },
  { path: '/terms', to: '/page/terms' },
  { path: '/return-policy', to: '/page/return-policy' },
  { path: '/order-track', to: '/track-order' },
  { path: '/order/success/ORD-100200', to: '/checkout/success/ORD-100200' },
];

/** Signed-out visitors must be sent to sign-in, not shown an empty account. */
const GUARDED = ['/account', '/account/orders', '/account/profile', '/account/security'];

async function verifyRoutes() {
  console.log('\n— Routes —');

  for (const page of PAGES) {
    const result = await request(page.path);
    check(`${page.path} → ${page.expect}`, result.status === page.expect, `got ${result.status}`);

    if (result.status === 200 && !page.skipHtmlChecks) checkHtml(page.path, result.body);
  }

  for (const redirect of REDIRECTS) {
    const result = await request(redirect.path);
    const redirected = result.status >= 300 && result.status < 400;
    check(
      `${redirect.path} redirects to ${redirect.to}`,
      redirected && (result.location ?? '').endsWith(redirect.to),
      `status ${result.status}, location ${result.location ?? 'none'}`,
    );
  }

  for (const path of GUARDED) {
    const result = await request(path);

    /*
     * Two shapes count as guarded. Next answers `redirect()` with a real 3xx
     * when it can, but once the response has begun streaming the status is
     * already sent — so the redirect arrives inside the RSC payload instead,
     * and the browser follows it from there. Asserting only on the status code
     * fails a page that is redirecting perfectly well.
     */
    const byStatus =
      result.status >= 300 && result.status < 400 && (result.location ?? '').includes('/login');
    const byStream = result.body.includes('NEXT_REDIRECT') && result.body.includes('/login');

    check(
      `${path} requires sign-in`,
      byStatus || byStream,
      `status ${result.status}, location ${result.location ?? 'none'}, no redirect in payload`,
    );
  }
}

async function verifyDesignMatrix() {
  console.log('\n— Design matrix (6 templates × 8 themes) —');

  const grid: string[] = [];

  for (const template of TEMPLATES) {
    const row: string[] = [];

    for (const theme of THEMES) {
      const result = await request(`/?template=${template}&theme=${theme}`);

      const themeApplied = new RegExp(
        `<style id="storefront-theme" data-theme="${theme}"`,
      ).test(result.body);

      const bodyClass = BODY_CLASS[template]!;
      const templateApplied = new RegExp(`<body[^>]*class="[^"]*${bodyClass}`).test(result.body);

      const clean =
        result.status === 200 &&
        !/Application error|Unhandled Runtime Error/.test(result.body);

      const ok = themeApplied && templateApplied && clean;
      row.push(ok ? '·' : '✗');

      check(
        `${template} + ${theme}`,
        ok,
        !clean
          ? `status ${result.status} or render error`
          : !themeApplied
            ? 'theme not applied'
            : 'template body class not applied',
      );
    }

    grid.push(`  ${template.padEnd(18)} ${row.join(' ')}`);
  }

  console.log(`  ${''.padEnd(18)} ${THEMES.map((t) => t.slice(0, 1)).join(' ')}`);
  for (const line of grid) console.log(line);
  console.log('  (· = pass, ✗ = fail)');
}

async function main() {
  console.log(`Verifying storefront at http://127.0.0.1:${PORT} (Host: ${HOST_HEADER})`);

  try {
    await request('/');
  } catch {
    console.error(
      `\nCould not reach the storefront on port ${PORT}. Start it with \`npm run dev\` first.`,
    );
    process.exit(1);
  }

  await verifyRoutes();
  await verifyDesignMatrix();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const failure of failures) console.log(`  ✗ ${failure}`);
  }

  process.exit(failed === 0 ? 0 : 1);
}

void main();
