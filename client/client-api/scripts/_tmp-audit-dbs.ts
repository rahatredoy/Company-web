import 'dotenv/config'
import pg from 'pg'

const shards = JSON.parse(process.env.TENANT_SHARDS || '[]')
const legacy = {
  id: 'legacy',
  host: process.env.TENANT_DB_HOST,
  port: Number(process.env.TENANT_DB_PORT),
  user: process.env.TENANT_DB_ADMIN_USER,
  password: process.env.TENANT_DB_ADMIN_PASSWORD,
  ssl: false,
}
const servers = [legacy, ...shards]

// control db
const ctl = new pg.Client({ connectionString: 'postgresql://postgres:fzckywuqyir75xoi@148.113.1.59:5531/company_control_db' })
await ctl.connect()
const t = await ctl.query(`select slug, tenant_ref, database_name, database_shard, status, store_status from tenants order by slug`)
console.log('=== tenants table (control db) ===')
for (const r of t.rows) console.log(`  ${r.slug.padEnd(18)} shard=${String(r.database_shard).padEnd(9)} db=${r.database_name}  [${r.status}/${r.store_status}]`)
await ctl.end()

console.log('')
for (const s of servers) {
  const c = new pg.Client({ host: s.host, port: s.port, user: s.user, password: s.password, database: 'postgres', ssl: false })
  try {
    await c.connect()
    const r = await c.query(`select datname, pg_size_pretty(pg_database_size(datname)) size from pg_database where datname like 'tenant%' or datname like 'company%' order by datname`)
    console.log(`=== ${s.id} (${s.host}:${s.port}) ===`)
    if (!r.rows.length) console.log('  (no tenant databases)')
    for (const row of r.rows) console.log(`  ${row.datname.padEnd(40)} ${row.size}`)
    await c.end()
  } catch (e) {
    console.log(`=== ${s.id} (${s.host}:${s.port}) === ERROR: ${(e as Error).message}`)
  }
  console.log('')
}
