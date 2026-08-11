import { desc, eq } from 'drizzle-orm';
import { closeDatabase, db } from '../src/db/client';
import { clientAccounts, notifications } from '../src/db/schema/index';

const email = `mail-probe-${Date.now()}@example.com`;
const res = await fetch('http://localhost:4000/api/v1/public/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ fullName: 'Mail Probe', email, phone: '+8801712345678', password: 'Sup3rSecret!Pass', acceptTerms: true }),
});
console.log('register status', res.status);

const rows = await db.select().from(notifications).where(eq(notifications.recipient, email)).orderBy(desc(notifications.createdAt));
for (const r of rows) console.log(`${r.template} | ${r.recipient} | ${r.status} | ${r.error ?? '-'}`);

await db.delete(clientAccounts).where(eq(clientAccounts.email, email));
await closeDatabase();
