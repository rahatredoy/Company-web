import {
  BarChart3,
  Boxes,
  CreditCard,
  Database,
  Globe,
  LayoutTemplate,
  Package,
  Palette,
  RotateCcw,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  package: Package,
  'shopping-cart': ShoppingCart,
  boxes: Boxes,
  users: Users,
  'credit-card': CreditCard,
  truck: Truck,
  'rotate-ccw': RotateCcw,
  'bar-chart-3': BarChart3,
  palette: Palette,
  'layout-template': LayoutTemplate,
  globe: Globe,
  database: Database,
  'shield-check': ShieldCheck,
  zap: Zap,
};

export function FeatureIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Package;
  return <Icon className={className} aria-hidden />;
}
