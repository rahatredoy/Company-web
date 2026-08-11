'use client';

import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Platform address or the client's own domain. A domain the plan does not cover
 * is shown locked rather than hidden — an option you cannot see is one you never
 * know you could upgrade for.
 */
export function AddressChoice({
  label,
  value,
  onChange,
  platformLabel,
  platformHint = 'Ready the moment your store is created.',
  customHint = 'You add a DNS record to verify it.',
  disabled,
  disabledHint = 'Not included in your plan — you can upgrade later.',
}: {
  label: string;
  value: 'platform' | 'custom';
  onChange: (value: 'platform' | 'custom') => void;
  platformLabel: string;
  platformHint?: string;
  customHint?: string;
  disabled?: boolean;
  disabledHint?: string;
}) {
  const options = [
    { key: 'platform' as const, title: platformLabel, hint: platformHint },
    { key: 'custom' as const, title: 'My own domain', hint: disabled ? disabledHint : customHint },
  ];

  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2 sm:grid-cols-2">
      {options.map((option) => {
        const selected = value === option.key;
        const locked = option.key === 'custom' && disabled;

        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={locked}
            onClick={() => onChange(option.key)}
            className={cn(
              'rounded-lg border px-4 py-3 text-left transition-colors',
              selected ? 'border-primary bg-primary-soft/40' : 'border-border hover:border-border-strong',
              locked && 'cursor-not-allowed opacity-60 hover:border-border',
            )}
          >
            <span className="flex items-center gap-1.5 text-sm font-medium">
              {locked ? <Lock className="size-3.5" aria-hidden /> : null}
              <span className="truncate">{option.title}</span>
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{option.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
