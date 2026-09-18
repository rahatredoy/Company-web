import * as React from 'react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';

/**
 * One block of the Settings screen.
 *
 * Tighter than `CardHeader`/`CardContent`, whose padding is sized for a page
 * with one card on it: Settings puts six side by side, and at that density the
 * default spacing is mostly whitespace. `action` sits on the title row — the
 * switch that turns a whole block on or off belongs beside its name rather than
 * on a line of its own.
 */
export function SettingsSection({
  title,
  action,
  className,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn('p-4', className)}>
      <div className="mb-3 flex min-h-6 items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </Card>
  );
}

/** The one height every control on the Settings screen shares. */
export const SETTINGS_CONTROL = 'h-9';
