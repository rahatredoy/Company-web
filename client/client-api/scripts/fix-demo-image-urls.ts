/**
 * Repairs the demo store's picture URLs in place.
 *
 *   npx tsx scripts/fix-demo-image-urls.ts            # the dev store
 *   npx tsx scripts/fix-demo-image-urls.ts --dry      # show what would change
 *   npx tsx scripts/fix-demo-image-urls.ts --slug abc-fashion
 *
 * `seed-demo-store.ts` built every image URL with `encodeURIComponent`, so a
 * two-word keyword became `.../600/600/dslr%20camera`. loremflickr refuses that
 * with a **403** and takes the comma form instead — `.../600/600/dslr,camera` —
 * which is why a seeded storefront rendered as a page of broken images and the
 * dev log filled with `upstream image response failed … 403`, one line per
 * picture per render.
 *
 * The seed script builds them correctly now, but the URLs already written are
 * rows in a tenant database, and re-seeding to repair a string would rebuild the
 * whole catalogue — new ids, new slugs, and anything the owner changed since
 * gone. This rewrites the strings and touches nothing else.
 *
 * It walks `information_schema` rather than a list of columns, because these
 * URLs are spread across settings, categories, brands, products, product media,
 * banners, collections and the homepage sections' JSON config — a list would be
 * one migration behind the day something new stores a picture.
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
 * `%20` → `,`, but only inside a loremflickr URL.
 *
 * A JSON config blob holds captions and link URLs beside the image, and a blunt
 * `replace(col, '%20', ',')` would edit those too. The match is anchored on the
 * host and stops at the first quote or space, so it can only ever consume the
 * one path segment. Applied four times because the expression rewrites one
 * space per URL per pass and the longest keyword here is three words — a fifth
 * pass would be a no-op, and every pass is idempotent.
 */
const ONE_PASS = (inner: string) =>
  `regexp_replace(${inner}, '(loremflickr\\.com/[^"\\s]*?)%20', '\\1,', 'g')`;

const REWRITE = (column: string) => {
  let expression = column;
  for (let pass = 0; pass < 4; pass += 1) expression = ONE_PASS(expression);
  return expression;
};

type Column = { table_name: string; column_name: string; data_type: string };

/**
 * The audit trail is a record of what was written, not a copy of it.
 *
 * `admin_audit_logs` holds the before/after of every admin write, so it carries
 * these URLs too — and it is the one place they must stay wrong. Rewriting them
 * would leave the log saying the seed wrote a value it never wrote, which is
 * the one thing an audit log exists not to do. Nothing renders from it.
 */
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

      // `::text` on both sides: a jsonb column cannot be pattern-matched or
      // rewritten directly, and casting the result back is what keeps the
      // column's own type — a string assigned to jsonb would be a JSON string.
      const asText = isJson ? `${name}::text` : name;
      const where = `${asText} like '%loremflickr.com/%\\%20%'`;

      const { rows } = await pool.query<{ count: string }>(
        `select count(*)::text as count from ${table} where ${where}`,
      );
      const affected = Number(rows[0]?.count ?? 0);
      if (affected === 0) continue;

      console.log(
        `${DRY ? 'would fix' : 'fixing  '} ${affected.toString().padStart(4)} row(s)  ` +
          `${column.table_name}.${column.column_name}`,
      );
      changed += affected;
      if (DRY) continue;

      const rewritten = isJson ? `(${REWRITE(`${name}::text`)})::${column.data_type}` : REWRITE(name);
      await pool.query(`update ${table} set ${name} = ${rewritten} where ${where}`);
    }

    if (changed === 0) {
      console.log('Nothing to fix — no loremflickr URL in this store carries an encoded space.');
    } else {
      console.log(`\n${DRY ? 'Would rewrite' : 'Rewrote'} ${changed} value(s).`);
    }
  } finally {
    await pool.end().catch(() => undefined);
  }

  /*
   * The storefront caches its reads in Redis for up to five minutes, and those
   * payloads carry the old URLs. A write through the admin API would have
   * dropped them by hook; this went straight to the tables, so it drops them
   * itself — otherwise the pictures stay broken for a TTL after the fix and it
   * reads as the fix not having worked.
   */
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
