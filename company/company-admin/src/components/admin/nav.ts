import {
  ClipboardList,
  CreditCard,
  FileText,
  Globe,
  LayoutDashboard,
  LifeBuoy,
  Package,
  ScrollText,
  Server,
  Settings,
  Timer,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface AdminNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  exact?: boolean;
}

/**
 * The complete admin sidebar. Infrastructure surfaces (database nodes, backups,
 * storage, Redis, queues, servers) are deliberately absent — those are managed
 * outside the application.
 */
export const ADMIN_NAV: AdminNavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, exact: true },
  { label: 'Clients', href: '/clients', icon: Users },
  { label: 'Subscriptions', href: '/subscriptions', icon: ClipboardList },
  { label: 'Plans', href: '/plans', icon: Package },
  { label: 'Trials', href: '/trials', icon: Timer },
  { label: 'Payments', href: '/payments', icon: CreditCard },
  { label: 'Invoices', href: '/invoices', icon: FileText },
  { label: 'Domains', href: '/domains', icon: Globe },
  { label: 'Provisioning', href: '/provisioning', icon: Server },
  { label: 'Support', href: '/support', icon: LifeBuoy },
  { label: 'Audit Logs', href: '/audit-logs', icon: ScrollText },
  { label: 'Settings', href: '/settings', icon: Settings },
];
