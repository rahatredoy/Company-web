import { redirect } from 'next/navigation';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { serverGetOptional } from '@/lib/server-api';
import { billingGate } from '@/lib/billing-gate';
import type { AccountOverview, ClientMe, OnboardingState, StoreView } from '@/lib/types';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const account = await serverGetOptional<ClientMe>('/api/v1/client/me');
  if (!account) redirect('/sign-in?next=%2Fdashboard');

  // Billing is not forced by a redirect. The dashboard is the landing place
  // after every sign-in and it *shows* what is outstanding — the plan, the bill
  // — with a way to finish it, while the shell locks everything that money has
  // not bought yet. Redirecting into the flow instead would take away support
  // and security from exactly the client whose payment is the problem.
  const [store, overview, signup] = await Promise.all([
    serverGetOptional<StoreView>('/api/v1/client/store'),
    serverGetOptional<AccountOverview>('/api/v1/client/overview'),
    serverGetOptional<OnboardingState>('/api/v1/client/onboarding'),
  ]);

  return (
    <DashboardShell
      account={account}
      store={store}
      businessName={overview?.business?.businessName ?? null}
      billing={billingGate(signup)}
    >
      {children}
    </DashboardShell>
  );
}
