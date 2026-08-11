import { redirect } from 'next/navigation';
import { getCustomer } from '@/lib/api/account';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { AccountNav } from '@/components/account/account-nav';

/**
 * The signed-in account shell.
 *
 * Guarded here rather than in `proxy.ts` so the check is a real session lookup
 * rather than "a cookie of some name exists". The API re-authorises every
 * request it receives regardless — this redirect is a courtesy so a signed-out
 * visitor lands on the sign-in page instead of an account area full of empty
 * states.
 */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const customer = await getCustomer();
  if (!customer) redirect('/login?next=/account');

  return (
    <div className="container-store py-6">
      <Breadcrumbs items={[{ label: 'My account' }]} className="mb-6" />

      <div className="grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-12">
        <AccountNav />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
