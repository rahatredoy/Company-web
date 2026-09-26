/**
 * Moves the demo store's pictures off loremflickr, onto picsum.photos.
 *
 *   npx tsx scripts/replace-demo-images.ts --slug e-comarch --dry   # count what would change
 *   npx tsx scripts/replace-demo-images.ts --slug e-comarch         # rewrite
 *
 * loremflickr answers any request that is not a browser with a **401 "Bot
 * check"** page instead of the picture. The storefront fetches every image on
 * the server (`/_next/image` resizes it before the browser sees it), so a
 * deployed store rendered a page of broken pictures while the API answered
 * every call with 200 — and the log filled with `upstream image response
 * failed … 401`, one line per picture per render.
 *
 * `https://loremflickr.com/600/600/dslr,camera?lock=103` becomes
 * `https://picsum.photos/seed/dslr,camera-103/600/600`: same size, and the
 * keyword and lock become the seed, so every URL keeps pointing at one fixed
 * picture and two products that had different pictures still do. picsum
 * pictures are random photographs, not the keyword — the demo trades matching
 * subjects for pictures that load.
 *
 * Like `fix-demo-image-urls.ts`, it walks `information_schema` rather than a
 * list of columns, skips the audit log, rewrites nothing but the URL, and is
 * idempotent: a rewritten URL no longer matches.
 */
import { config } from '../src/config/index';
import { openTenantPoolForSlug } from '../src/db/tenant-manager';
import { STOREFRONT_CACHE_SCOPE, invalidateTenantCache } from '../src/lib/cache';
import { fetchTenantBySlug } from '../src/lib/company-client';
import { closeRedis } from '../src/lib/redis';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

const SLUG = arg('slug') ?? config.devStoreSlug;
const DRY = process.argv.includes('--dry');

if (!SLUG) {
  console.error('No store. Pass --slug <store-slug>, or set DEV_STORE_SLUG in .env.');
  process.exit(1);
}

/**
 * Width, height, keywords and the optional lock, each captured; the match stops
 * at a quote, a space or a backslash, so inside a JSON blob it can only ever
 * consume the one URL. A URL with no lock seeds on its keywords alone.
 */
const PATTERN = String.raw`https?://loremflickr\.com/(\d+)/(\d+)/([^"\s\\?]+)(\?lock=(\d+))?`;
const REPLACEMENT = String.raw`https://picsum.photos/seed/\3-\5/\1/\2`;
const REWRITE = (text: string) => `regexp_replace(${text}, '${PATTERN}', '${REPLACEMENT}', 'g')`;

type Column = { table_name: string; column_name: string; data_type: string };

/** The audit log records what was written; rewriting it would falsify it. */
const SKIP_TABLES = new Set(['admin_audit_logs']);

async function main(): Promise<void> {
  console.log(`Store: ${SLUG}${DRY ? '  (dry run)' : ''}\n`);

  const pool = await openTenantPoolForSlug(SLUG!);
  let changed = 0;

  try {
    const { rows: columns } = await pool.query<Column>(
      `select c.table_name, c.column_name, c.data_type
         from information_schema.columns c
         join information_schema.tables t
           on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public'
          and t.table_type = 'BASE TABLE'
          and c.data_type in ('text', 'character varying', 'jsonb', 'json')
        order by c.table_name, c.column_name`,
    );

    for (const column of columns) {
      if (SKIP_TABLES.has(column.table_name)) continue;
      const table = `"${column.table_name}"`;
      const name = `"${column.column_name}"`;
      const isJson = column.data_type === 'jsonb' || column.data_type === 'json';
      const asText = isJson ? `${name}::text` : name;
      const where = `${asText} like '%loremflickr.com/%'`;

      const { rows } = await pool.query<{ count: string }>(
        `select count(*)::text as count from ${table} where ${where}`,
      );
      const affected = Number(rows[0]?.count ?? 0);
      if (affected === 0) continue;

      console.log(
        `${DRY ? 'would move' : 'moving    '} ${affected.toString().padStart(4)} row(s)  ` +
          `${column.table_name}.${column.column_name}`,
      );
      changed += affected;
      if (DRY) continue;

      // Cast back to the column's own type, or a jsonb column would receive a
      // JSON string instead of the object it held.
      const rewritten = isJson ? `(${REWRITE(`${name}::text`)})::${column.data_type}` : REWRITE(name);
      await pool.query(`update ${table} set ${name} = ${rewritten} where ${where}`);
    }

    if (changed === 0) {
      console.log('Nothing to move — no loremflickr URL left in this store.');
    } else {
      console.log(`\n${DRY ? 'Would rewrite' : 'Rewrote'} ${changed} value(s).`);
    }

    if (!DRY && changed > 0) {
      const { rows } = await pool.query<{ left: string }>(
        `select count(*)::text as left from product_media where url like '%loremflickr.com/%'`,
      );
      console.log(`loremflickr URLs left in product_media: ${rows[0]?.left ?? '?'}`);
    }
  } finally {
    await pool.end().catch(() => undefined);
  }

  // Straight to the tables, so no admin-write hook dropped the cached payloads
  // that still carry the old URLs.
  if (!DRY && changed > 0) {
    const tenant = await fetchTenantBySlug(SLUG!).catch(() => null);
    if (tenant) {
      await invalidateTenantCache(tenant.tenantRef, STOREFRONT_CACHE_SCOPE);
      console.log('Storefront cache dropped.');
    } else {
      console.log('Could not reach company-api to drop the storefront cache; it expires within 5 minutes.');
    }
  }

  await closeRedis().catch(() => undefined);
}

main().catch(async (error) => {
  console.error(error);
  await closeRedis().catch(() => undefined);
  process.exit(1);
});
