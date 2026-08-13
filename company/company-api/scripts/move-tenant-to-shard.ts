/**
 * Moves a store's database from the shard it is on to another one.
 *
 *   npx tsx scripts/move-tenant-to-shard.ts --slug abc-fashion --to shard-1
 *   npx tsx scripts/move-tenant-to-shard.ts --all --to shard-1
 *   npx tsx scripts/move-tenant-to-shard.ts --all --to shard-1 --drop-source
 *
 * Copy, verify, then repoint — in that order, and the source is left in place
 * unless `--drop-source` says otherwise. A move that half-succeeds should cost a
 * disk, not a store.
 *
 * The store is briefly inconsistent if it is being written to while the dump
 * runs, so this is not an online migration: take the store offline, or accept
 * that whatever lands after the dump starts is left behind on the old shard.
 *
 * Needs `pg_dump` and `pg_restore` of at least the servers' major version. Set
 * PG_BIN to point at them if they are not on PATH.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { config, type TenantShard } from '../src/config/index';
import { db, pool } from '../src/db/client';
import { tenants } from '../src/db/schema/index';
import { invalidateTenantCache } from '../src/lib/tenant-cache';
import { closeRedis } from '../src/lib/redis';
import { locateShard, shardClientOptions } from '../src/services/tenant-shards';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

/** `pg_dump` is not on PATH in a default Windows install. */
function findBinary(name: string): string {
  const explicit = process.env.PG_BIN;
  if (explicit) {
    const candidate = join(explicit, `${name}.exe`);
    if (existsSync(candidate)) return candidate;
    const bare = join(explicit, name);
    if (existsSync(bare)) return bare;
  }

  for (const root of ['C:/Program Files/PostgreSQL', 'C:/Program Files (x86)/PostgreSQL']) {
    if (!existsSync(root)) continue;
    // Highest major version first — it can dump every older server.
    const versions = readdirSync(root).sort((a, b) => Number(b) - Number(a));
    for (const version of versions) {
      const candidate = join(root, version, 'bin', `${name}.exe`);
      if (existsSync(candidate)) return candidate;
    }
  }

  return name; // Trust PATH, and let the spawn failure say so.
}

function run(command: string, args: string[], password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, PGPASSWORD: password },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => reject(new Error(`${command}: ${error.message}`)));
    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${command} exited ${code}\n${stderr.trim()}`));
    });
  });
}

/** Row counts for every table, which is what "the copy is complete" has to mean. */
async function tableCounts(shard: TenantShard, database: string): Promise<Map<string, number>> {
  const client = new pg.Client(shardClientOptions(shard, database));
  await client.connect();
  try {
    const { rows } = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name`,
    );

    const counts = new Map<string, number>();
    for (const { table_name: table } of rows) {
      const result = await client.query<{ total: string }>(`select count(*) as total from "${table}"`);
      counts.set(table, Number(result.rows[0]!.total));
    }
    return counts;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function databaseExists(shard: TenantShard, database: string): Promise<boolean> {
  const client = new pg.Client(shardClientOptions(shard, 'postgres'));
  await client.connect();
  try {
    const found = await client.query('select 1 from pg_database where datname = $1', [database]);
    return Boolean(found.rowCount);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function moveOne(
  tenant: { id: string; slug: string; databaseName: string; databaseShard: string | null },
  target: TenantShard,
  dropSource: boolean,
): Promise<boolean> {
  const { slug, databaseName } = tenant;
  const label = `  ${slug.padEnd(20)}`;

  const source = await locateShard(databaseName);
  if (!source) {
    console.log(`${label} SKIP — no shard holds ${databaseName}`);
    return false;
  }

  if (source.id === target.id) {
    // Still worth recording, for a store that was already in the right place but
    // predates the column.
    if (tenant.databaseShard !== target.id) {
      await db.update(tenants).set({ databaseShard: target.id, updatedAt: new Date() }).where(eq(tenants.id, tenant.id));
      await invalidateTenantCache(tenant.id).catch(() => undefined);
      console.log(`${label} already on ${target.id} — recorded`);
      return true;
    }
    console.log(`${label} already on ${target.id}`);
    return true;
  }

  if (await databaseExists(target, databaseName)) {
    // Restoring over an existing database would merge two stores' rows.
    console.log(`${label} SKIP — ${databaseName} already exists on ${target.id}`);
    return false;
  }

  const dumpFile = join(tmpdir(), `${databaseName}.${process.pid}.dump`);
  const pgDump = findBinary('pg_dump');
  const pgRestore = findBinary('pg_restore');

  try {
    process.stdout.write(`${label} ${source.id} -> ${target.id}  dump…`);
    await run(
      pgDump,
      ['-h', source.host, '-p', String(source.port), '-U', source.user, '-d', databaseName, '-Fc', '-f', dumpFile],
      source.password,
    );

    process.stdout.write(' create…');
    const admin = new pg.Client(shardClientOptions(target, 'postgres'));
    await admin.connect();
    try {
      await admin.query(`create database "${databaseName}"`);
    } finally {
      await admin.end().catch(() => undefined);
    }

    process.stdout.write(' restore…');
    await run(
      pgRestore,
      ['-h', target.host, '-p', String(target.port), '-U', target.user, '-d', databaseName, '--no-owner', '--exit-on-error', dumpFile],
      target.password,
    );

    process.stdout.write(' verify…');
    const before = await tableCounts(source, databaseName);
    const after = await tableCounts(target, databaseName);

    const mismatches: string[] = [];
    for (const [table, total] of before) {
      const copied = after.get(table);
      if (copied !== total) mismatches.push(`${table} ${total}→${copied ?? 'missing'}`);
    }

    if (mismatches.length) {
      // The tenant row is untouched, so the store keeps reading the source.
      console.log(` FAILED\n${label} copy does not match: ${mismatches.join(', ')}`);
      return false;
    }

    await db
      .update(tenants)
      .set({ databaseShard: target.id, updatedAt: new Date() })
      .where(eq(tenants.id, tenant.id));

    // The commerce API caches the tenant record, shard id included.
    await invalidateTenantCache(tenant.id).catch(() => undefined);

    console.log(` ok  (${before.size} tables, ${[...before.values()].reduce((a, b) => a + b, 0)} rows)`);

    if (dropSource) {
      const sourceAdmin = new pg.Client(shardClientOptions(source, 'postgres'));
      await sourceAdmin.connect();
      try {
        await sourceAdmin.query(`drop database "${databaseName}" with (force)`);
        console.log(`${label} source dropped from ${source.id}`);
      } finally {
        await sourceAdmin.end().catch(() => undefined);
      }
    }

    return true;
  } catch (error) {
    console.log(` FAILED\n${label} ${(error as Error).message}`);
    return false;
  } finally {
    rmSync(dumpFile, { force: true });
  }
}

async function main(): Promise<void> {
  const targetId = arg('to');
  const slug = arg('slug');
  const all = flag('all');

  if (!targetId || (!slug && !all)) {
    console.error('Usage: --to <shard-id> (--slug <store-slug> | --all) [--drop-source]');
    process.exitCode = 1;
    return;
  }

  const target = config.tenantDb.shards.find((shard) => shard.id === targetId);
  if (!target) {
    console.error(
      `Unknown shard "${targetId}". Known: ${config.tenantDb.shards.map((s) => s.id).join(', ')}`,
    );
    process.exitCode = 1;
    return;
  }

  const rows = await db
    .select({
      id: tenants.id,
      slug: tenants.slug,
      databaseName: tenants.databaseName,
      databaseShard: tenants.databaseShard,
    })
    .from(tenants);

  const wanted = rows.filter(
    (row) => row.databaseName && (all || row.slug === slug),
  ) as { id: string; slug: string; databaseName: string; databaseShard: string | null }[];

  if (!wanted.length) {
    console.log(slug ? `\n  No provisioned store named "${slug}".\n` : '\n  No provisioned stores.\n');
    return;
  }

  console.log(`\n  Moving ${wanted.length} store(s) to ${target.id} (${target.host}:${target.port})\n`);

  let moved = 0;
  for (const tenant of wanted) {
    if (await moveOne(tenant, target, flag('drop-source'))) moved += 1;
  }

  console.log(`\n  ${moved}/${wanted.length} done.`);
  if (!flag('drop-source') && moved) {
    console.log('  Source databases were left in place. Re-run with --drop-source once you are satisfied.\n');
  }
}

await main();
await pool.end().catch(() => undefined);
await closeRedis().catch(() => undefined);
