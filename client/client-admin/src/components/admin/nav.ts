import type { LucideIcon } from 'lucide-react';
import {
  BadgePercent,
  Boxes,
  ChartNoAxesCombined,
  CircleHelp,
  FileText,
  Gauge,
  Globe,
  Image,
  LayoutGrid,
  LayoutTemplate,
  Mail,
  MessageSquareText,
  Package,
  RotateCcw,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Star,
  Tags,
  Truck,
  Users,
  Wallet,
  Warehouse,
} from 'lucide-react';
import type { Permission } from '@/lib/types';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Hidden unless the signed-in admin holds this. The API enforces it too. */
  permission: Permission;
  /** Matches child routes as well, e.g. /products/<id>. */
  exact?: boolean;
}

export interface NavSection {
  label: string;
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
      { label: 'Inventory', href: '/inventory', icon: Warehouse, permission: 'inventory.view' },
      { label: 'Shipping', href: '/shipping', icon: Truck, permission: 'orders.view' },
      { label: 'Returns', href: '/returns', icon: RotateCcw, permission: 'returns.view' },
      { label: 'Refunds', href: '/refunds', icon: Wallet, permission: 'refunds.view' },
    ],
  },
  {
    label: 'Customers',
    items: [
      { label: 'Customers', href: '/customers', icon: Users, permission: 'customers.view' },
      { label: 'Reviews', href: '/reviews', icon: Star, permission: 'reviews.view' },
    ],
  },
  {
    label: 'Marketing',
    items: [
      { label: 'Discounts', href: '/discounts', icon: BadgePercent, permission: 'marketing.view' },
      { label: 'Banners', href: '/banners', icon: Image, permission: 'marketing.view' },
      { label: 'Newsletter', href: '/newsletter', icon: MessageSquareText, permission: 'marketing.view' },
      { label: 'Messages', href: '/messages', icon: Mail, permission: 'marketing.view' },
    ],
  },
  {
    label: 'Website',
    items: [
      { label: 'Design', href: '/website/design', icon: Globe, permission: 'website.view' },
      { label: 'Homepage', href: '/website/homepage', icon: LayoutTemplate, permission: 'website.view' },
      { label: 'Pages', href: '/website/pages', icon: FileText, permission: 'website.view' },
      { label: 'FAQs', href: '/website/faqs', icon: CircleHelp, permission: 'website.view' },
    ],
  },
  {
    label: 'Insight',
    items: [{ label: 'Reports', href: '/reports', icon: ChartNoAxesCombined, permission: 'reports.view' }],
  },
  {
    label: 'Store',
    items: [
      { label: 'Staff', href: '/staff', icon: ShieldCheck, permission: 'staff.view' },
      { label: 'Settings', href: '/settings', icon: Settings, permission: 'settings.view' },
    ],
  },
];

export function isActive(pathname: string, item: NavItem): boolean {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
