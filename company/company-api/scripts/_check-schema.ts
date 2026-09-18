import { db, closeDatabase } from '../src/db/client';
import { sql } from 'drizzle-orm';

for (const table of ['client_email_verification_tokens']) {
  const res = await db.execute(sql`
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns where table_name = ${table} order by ordinal_position`);
  console.log(`\n== ${table} ==`);
  for (const r of res.rows as Record<string, unknown>[]) {
    console.log(` ${r.column_name} | ${r.data_type} | null=${r.is_nullable} | default=${r.column_default ?? '-'}`);
  }
}
await closeDatabase();
