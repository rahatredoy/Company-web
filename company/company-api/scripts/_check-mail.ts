import { db, closeDatabase } from '../src/db/client';
import { notifications } from '../src/db/schema/index';
import { desc } from 'drizzle-orm';

const rows = await db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(10);
for (const r of rows) {
  console.log([r.createdAt?.toISOString(), r.template, r.recipient, r.status, r.error ?? ''].join(' | '));
}
if (!rows.length) console.log('(no notification rows)');
await closeDatabase();
