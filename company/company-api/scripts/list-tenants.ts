/**
 * Shows every provisioned store and the owner account that can sign in to it.
 *
 *   npx tsx scripts/list-tenants.ts
 *
 * Passwords are never stored in a form this can print — only whether one has
 * been set. An owner who has not claimed their account yet shows as `invited`.
 */
import pg from 'pg';
import { config } from '../src/config/index';
import { tenantDatabaseName } from '../src/lib/utils';

const company = new pg.Pool({ connectionString: config.database.url, max: 2 });

async function main(): Promise<void> {
  const { rows: tenants } = await company.query(`
    select t.tenant_ref, t.slug, t.store_name, t.status, t.store_status,
           t.storefront_template, p.code as plan_code, c.email as client_email
      from tenants t
      left join subscriptions s on s.tenant_id = t.id
      left join plans p on p.id = s.plan_id
      left join client_accounts c on c.id = t.client_account_id
     order by t.created_at
  `);

  if (tenants.length === 0) {
    console.log('\n  No tenants provisioned yet.\n');
    return;
  }

  console.log(`\n  ${tenants.length} store(s) provisioned:\n`);

  for (const tenant of tenants) {
    console.log(`  ${tenant.store_name}  (${tenant.slug})`);
    console.log(`    tenant ref    ${tenant.tenant_ref}`);
    console.log(`    status        ${tenant.status} / store ${tenant.store_status}`);
    console.log(`    plan          ${tenant.plan_code ?? '—'}`);
    console.log(`    client login  ${tenant.client_email ?? '—'}   (company website)`);
    console.log(`    admin panel   http://${tenant.slug}.localhost:3002`);

    // The store admin lives in the tenant's own database, so each one needs its
    // own connection — there is no cross-tenant view by design.
    const tenantPool = new pg.Pool({
      host: config.tenantDb.host,
      port: config.tenantDb.port,
      user: config.tenantDb.user,
      password: config.tenantDb.password,
      database: tenantDatabaseName(tenant.slug, config.tenantDb.namePrefix),
      ssl: config.tenantDb.ssl ? { rejectUnauthorized: false } : undefined,
      max: 1,
      connectionTimeoutMillis: 8_000,
    });

    try {
      const { rows: admins } = await tenantPool.query(`
        select email, full_name, role_key, account_status,
               password_hash is not null as has_password
          from store_admins order by created_at
      `);

      for (const admin of admins) {
        console.log(
          `    owner         ${admin.email}  ${admin.role_key}  ${admin.account_status}` +
            `  ${admin.has_password ? 'password set' : 'NOT CLAIMED — no password'}`,
        );
      }
    } catch (error) {
      console.log(`    owner         (tenant database unreachable: ${(error as Error).message})`);
    } finally {
      await tenantPool.end().catch(() => undefined);
    }

    console.log('');
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await company.end().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });
