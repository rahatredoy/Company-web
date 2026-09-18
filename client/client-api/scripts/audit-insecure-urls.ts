/**
 * Every stored address that is not https, across one tenant or the whole cluster.
 *
 *   npx tsx scripts/audit-insecure-urls.ts                 # the dev store
 *   npx tsx scripts/audit-insecure-urls.ts --slug abc-shop
 *   npx tsx scripts/audit-insecure-urls.ts --all           # every tenant on every shard
 *
 * The write validators refuse `http:`, `javascript:` and `data:` now (see
 * `lib/secure-url.ts`), but a validator only guards what is written *after* it
 * exists. Rows already in the table were never asked, and there are two of them
 * worth telling apart:
 *
 *   * **`http://`** — mixed content. The picture will not render on an https
 *     page and the link quietly downgrades whoever follows it. Harmless to fix
 *     and usually just needs the scheme changed.
 *   * **`javascript:` / `data:`** — script the storefront would serve to its own
 *     customers under the shop's own origin. The storefront's `sections/parse.ts`
 *     and `lib/sanitise.ts` refuse them at render, so nothing is executing, but
 *     a row like this is evidence rather than a formatting problem. It is the
 *     only thing that makes this script exit non-zero.
 *
 * Read-only throughout, and it discovers its own columns from `information_schema`
 * rather than carrying a list — a URL column added later is covered without this
 * script being touched, which is the opposite of how a hard-coded list ages.
 *
 * **`--all` enumerates the shards, not the control plane.** `client-api` never
 * opens `company_control_db`, so there is no tenant list on this side to read;
 * what it does hold is the shard registry, and a shard knows its own databases.
 * So the sweep asks each server for the databases carrying the tenant prefix.
 * That is deliberately a *superset* of what the control plane would list — a
 * store left behind by a half-finished `move-tenant-to-shard` still answers to
 * its own name, and an audit that skipped it would be reporting on the platform
 * it wished it had.
 */
import pg from 'pg';
import { config } from '../src/config/index';
import { openTenantPoolForSlug } from '../src/db/tenant-manager';
import { shardList } from '../src/db/tenant-shards';
import { closeRedis } from '../src/lib/redis';
import type { TenantShard } from '../src/config/index';

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : undefined;
};
const has = (name: string): boolean => argv.includes(`--${name}`);

const AUDIT_ALL = has('all');
const SLUG = arg('slug') ?? config.devStoreSlug ?? 'e-comarch';

/** Columns whose name says they hold an address. */
const COLUMN_SQL = `
  SELECT table_name, column_name
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND data_type IN ('text', 'character varying')
     AND (column_name LIKE '%url%' OR column_name LIKE '%_uri')
   ORDER BY table_name, column_name
`;

interface Finding {
  store: string;
  table: string;
  column: string;
  value: string;
  count: number;
}

const HOSTILE_SCHEMES = /^(javascript|data|vbscript|file):/i;

/** One store's URL columns, swept. */
async function auditPool(pool: pg.Pool, store: string): Promise<Finding[]> {
  const columns = (await pool.query<{ table_name: string; column_name: string }>(COLUMN_SQL)).rows;
  const findings: Finding[] = [];

  for (const { table_name: table, column_name: column } of columns) {
    /*
     * Identifiers are quoted rather than interpolated raw. They come from
     * `information_schema` and not from a request, so this is belt and braces —
     * but a script that builds SQL from strings should look the same whether or
     * not today's source happens to be trusted.
     */
    const quoted = (name: string): string => `"${name.replace(/"/g, '""')}"`;
    const ref = `${quoted(table)}.${quoted(column)}`;
    const sql = `
      SELECT ${ref} AS value, count(*)::int AS count
        FROM ${quoted(table)}
       WHERE ${ref} IS NOT NULL
         AND ${ref} <> ''
         AND ${ref} NOT LIKE 'https://%'
         AND ${ref} NOT LIKE '/%'
       GROUP BY 1
       ORDER BY 2 DESC
       LIMIT 20
    `;

    try {
      const rows = (await pool.query<{ value: string; count: number }>(sql)).rows;
      for (const row of rows) findings.push({ store, table, column, ...row });
    } catch {
      // A column the audit cannot read (a view, a table dropped mid-migration)
      // is skipped rather than aborting the sweep.
      continue;
    }
  }

  return findings;
}

/**
 * Every tenant database this cluster holds, discovered from the shards.
 *
 * Deduplicated on `host:port:database`, because two registry entries can name
 * the same server — `legacy` is the pre-sharding host and may well be one of the
 * numbered shards under another name.
 */
async function everyTenantDatabase(): Promise<{ shard: TenantShard; database: string }[]> {
  const prefix = config.tenantDb.namePrefix;
  const seen = new Set<string>();
  const found: { shard: TenantShard; database: string }[] = [];

  for (const shard of shardList()) {
    const client = new pg.Client({
      host: shard.host,
      port: shard.port,
      user: shard.user,
      password: shard.password,
      database: 'postgres',
      ssl: shard.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 8_000,
      application_name: 'client-api:audit-insecure-urls',
    });

    try {
      await client.connect();
      const { rows } = await client.query<{ datname: string }>(
        `SELECT datname FROM pg_database
          WHERE datistemplate = false AND datname LIKE $1
          ORDER BY datname`,
        [`${prefix}%`],
      );
      for (const { datname } of rows) {
        const key = `${shard.host}:${shard.port}:${datname}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ shard, database: datname });
      }
    } catch (error) {
      // A shard that is down must not stop the sweep of the ones that are up —
      // but it must be said, or an audit of half the cluster reads as an audit
      // of all of it.
      console.log(
        `  !! shard ${shard.id} (${shard.host}:${shard.port}) unreachable — NOT audited: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  return found;
}

const findings: Finding[] = [];
let storesAudited = 0;

try {
  if (AUDIT_ALL) {
    console.log('\nenumerating tenant databases across every shard…\n');
    const databases = await everyTenantDatabase();
    console.log(`  ${databases.length} tenant database(s) found\n`);

    for (const { shard, database } of databases) {
      const pool = new pg.Pool({
        host: shard.host,
        port: shard.port,
        user: shard.user,
        password: shard.password,
        database,
        ssl: shard.ssl ? { rejectUnauthorized: false } : undefined,
        max: 2,
        connectionTimeoutMillis: 8_000,
        application_name: 'client-api:audit-insecure-urls',
      });
      try {
        findings.push(...(await auditPool(pool, `${database} @ ${shard.id}`)));
        storesAudited += 1;
      } catch (error) {
        console.log(
          `  !! ${database} @ ${shard.id} could not be audited: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        await pool.end().catch(() => undefined);
      }
    }
  } else {
    const pool = await openTenantPoolForSlug(SLUG);
    try {
      console.log(`\nauditing "${SLUG}"\n`);
      findings.push(...(await auditPool(pool, SLUG)));
      storesAudited = 1;
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  const hostile = findings.filter((f) => HOSTILE_SCHEMES.test(f.value));
  const plaintext = findings.filter((f) => /^http:\/\//i.test(f.value));
  const other = findings.filter((f) => !hostile.includes(f) && !plaintext.includes(f));

  const report = (label: string, list: Finding[]): void => {
    if (list.length === 0) return;
    console.log(`${label}\n`);
    for (const f of list) {
      const where = AUDIT_ALL ? `${f.store}  ` : '';
      console.log(`  ${where}${f.table}.${f.column}  x${f.count}  ${f.value.slice(0, 90)}`);
    }
    console.log();
  };

  report('SCRIPT-BEARING — investigate, these are not a formatting problem:', hostile);
  report('PLAINTEXT http:// — mixed content on an https page:', plaintext);
  report('Neither https nor a /path — check these are addresses at all:', other);

  if (findings.length === 0) {
    console.log(
      `  clean — every stored address across ${storesAudited} store(s) is https:// or an internal /path\n`,
    );
  } else {
    console.log(
      `  ${storesAudited} store(s): ${hostile.length} script-bearing, ` +
        `${plaintext.length} plaintext, ${other.length} other\n`,
    );
  }

  process.exitCode = hostile.length > 0 ? 1 : 0;
} finally {
  await closeRedis().catch(() => undefined);
}
