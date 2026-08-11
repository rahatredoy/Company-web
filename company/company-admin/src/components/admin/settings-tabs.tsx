'use client';

import { useRouter } from 'next/navigation';
import { Tabs } from '@/components/ui/tabs';
import type { SettingsTab } from '@/lib/settings-tabs';

/**
 * Tab selection lives in the URL rather than component state, so
 * `/settings?tab=security` from the topbar lands on the right tab with no
 * flash and the view stays shareable. The panel content itself is still
 * server-rendered and passed through as children.
 */
export function SettingsTabs({ value, children }: { value: SettingsTab; children: React.ReactNode }) {
  const router = useRouter();

  return (
    <Tabs
      value={value}
      onValueChange={(next) => router.replace(`/settings?tab=${next}`, { scroll: false })}
    >
      {children}
    </Tabs>
  );
}
