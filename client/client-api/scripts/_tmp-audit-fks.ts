import pg from 'pg'
const ctl = new pg.Client({ connectionString: 'postgresql://postgres:fzckywuqyir75xoi@148.113.1.59:5531/company_control_db' })
await ctl.connect()
const fks = await ctl.query(`
  select tc.table_name as child, kcu.column_name as col, ccu.table_name as parent, rc.delete_rule
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
  join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
  join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
  where tc.constraint_type='FOREIGN KEY' and ccu.table_name in ('tenants','client_accounts')
  order by ccu.table_name, tc.table_name`)
console.log('=== FKs pointing at tenants / client_accounts ===')
for (const r of fks.rows) console.log(`  ${r.child}.${r.col} -> ${r.parent}  ON DELETE ${r.delete_rule}`)
await ctl.end()
