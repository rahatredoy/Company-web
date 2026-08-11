import {
  CreditCard,
  FileText,
  LayoutDashboard,
  LifeBuoy,
  Settings,
  ShieldCheck,
  Store,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface AccountNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  exact?: boolean;
  /**
   * Locked until the plan's bill has been paid. The lock is cosmetic — the page
   * itself refuses independently, and the API refuses under both of them.
   */
  requiresBilling?: boolean;
}

export interface AccountNavGroup {
  /** Null renders the items with no heading — used for the top-level entry. */
  label: string | null;
  items: AccountNavItem[];
}

/**
 * The SaaS account only. Products, orders, inventory and customers are the store
 * admin panel's job and must never appear here — see the Apps switcher for the
 * way across.
 *
 * Billing sits directly under the overview, above the store, because it is the
 * first thing that has to happen: no plan and no settled bill means no store,
 * and an account that has not paid can reach nothing else here. Putting it
 * anywhere lower would advertise doors that are all locked.
 *
 * There is one entry for the store, not four. Setting up the website, naming the
 * admin panel and connecting a domain are steps in building one thing, and the
 * store page walks through them in order — as separate destinations they were
 * four doors into a room the visitor had not been told they needed to enter.
 *
 * `My Store` is deliberately **not** locked before the bill is paid. It is the
 * thing being bought: someone deciding whether to pay has to be able to look at
 * what setup will build. The page shows all of it and refuses only the one action
 * that costs money, which it explains at the moment it is pressed.
 */
export const ACCOUNT_NAV: AccountNavGroup[] = [
  {
    label: null,
    items: [{ label: 'Overview', href: '/dashboard', icon: LayoutDashboard, exact: true }],
  },
  {
    label: 'Billing',
    items: [
      { label: 'Plans & Billing', href: '/dashboard/plans', icon: CreditCard },
      { label: 'Payments', href: '/dashboard/billing', icon: Wallet },
      { label: 'Invoices', href: '/dashboard/invoices', icon: FileText, requiresBilling: true },
    ],
  },
  {
    label: 'Store',
    items: [{ label: 'My Store', href: '/dashboard/store', icon: Store }],
  },
  {
    label: 'Account',
    items: [
      { label: 'Support', href: '/dashboard/support', icon: LifeBuoy },
      { label: 'Security', href: '/dashboard/security', icon: ShieldCheck },
      { label: 'Settings', href: '/dashboard/settings', icon: Settings },
    ],
  },
];
