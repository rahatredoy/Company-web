import type { LucideIcon } from 'lucide-react';
import {
  BadgePercent,
  Boxes,
  CircleHelp,
  FileText,
  Gauge,
  Image,
  LayoutGrid,
  Mail,
  Package,
  RotateCcw,
  Settings,
  ShoppingCart,
  Tags,
  Users,
} from 'lucide-react';
import type { MessageKey } from '@/lib/i18n';
import type { Permission } from '@/lib/types';

/** Labels are dictionary keys, translated where they are drawn. */
export interface NavItem {
  label: MessageKey;
  href: string;
  icon: LucideIcon;
  /** Hidden unless the signed-in admin holds this (any one, for a list). The API enforces it too. */
  permission: Permission | Permission[];
  /** Matches child routes as well, e.g. /products/<id>. */
  exact?: boolean;
}

export interface NavSection {
  label: MessageKey;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', href: '/dashboard', icon: Gauge, permission: 'dashboard.view', exact: true }],
  },
  {
    label: 'Catalogue',
    items: [
      { label: 'Products', href: '/products', icon: Package, permission: 'products.view' },
      { label: 'Categories', href: '/categories', icon: LayoutGrid, permission: 'categories.view' },
      { label: 'Brands', href: '/brands', icon: Tags, permission: 'brands.view' },
      { label: 'Attributes', href: '/attributes', icon: Boxes, permission: 'attributes.view' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Orders', href: '/orders', icon: ShoppingCart, permission: 'orders.view' },
      // One screen, two tabs: a refund is raised by a completed return.
      {
        label: 'Returns & refunds',
        href: '/returns',
        icon: RotateCcw,
        permission: ['returns.view', 'refunds.view'],
      },
    ],
  },
  {
    label: 'Customers',
    items: [
      { label: 'Customers', href: '/customers', icon: Users, permission: 'customers.view' },
    ],
  },
  {
    label: 'Marketing',
    items: [
      { label: 'Discounts', href: '/discounts', icon: BadgePercent, permission: 'marketing.view' },
      { label: 'Banners', href: '/banners', icon: Image, permission: 'marketing.view' },
      { label: 'Messages', href: '/messages', icon: Mail, permission: 'marketing.view' },
    ],
  },
  {
    label: 'Website',
    items: [
      { label: 'Pages', href: '/website/pages', icon: FileText, permission: 'website.view' },
      { label: 'FAQs', href: '/website/faqs', icon: CircleHelp, permission: 'website.view' },
    ],
  },
  {
    label: 'Store',
    items: [{ label: 'Settings', href: '/settings', icon: Settings, permission: 'settings.view' }],
  },
];

export function isActive(pathname: string, item: NavItem): boolean {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
