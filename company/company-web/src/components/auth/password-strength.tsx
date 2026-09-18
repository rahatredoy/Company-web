'use client';

import { cn } from '@/lib/utils';

const RULES = [
  { label: '10+ characters', test: (v: string) => v.length >= 10 },
  { label: 'Lowercase letter', test: (v: string) => /[a-z]/.test(v) },
  { label: 'Uppercase letter', test: (v: string) => /[A-Z]/.test(v) },
  { label: 'Number', test: (v: string) => /\d/.test(v) },
  { label: 'Symbol', test: (v: string) => /[^A-Za-z0-9]/.test(v) },
];

const LEVELS = [
  { label: 'Very weak', bar: 'bg-destructive', text: 'text-destructive' },
  { label: 'Weak', bar: 'bg-destructive', text: 'text-destructive' },
  { label: 'Fair', bar: 'bg-warning', text: 'text-warning' },
  { label: 'Good', bar: 'bg-info', text: 'text-info' },
  { label: 'Strong', bar: 'bg-success', text: 'text-success' },
  { label: 'Excellent', bar: 'bg-success', text: 'text-success' },
];

export function PasswordStrength({ value }: { value: string }) {
  const passed = RULES.filter((rule) => rule.test(value)).length;
  const level = LEVELS[passed] ?? LEVELS[0]!;

  if (!value) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-hidden>
          {RULES.map((_, index) => (
            <span
              key={index}
              className={cn('h-1 flex-1 rounded-full transition-colors', index < passed ? level.bar : 'bg-muted')}
            />
          ))}
        </div>
        <span className={cn('text-xs font-medium', level.text)}>{level.label}</span>
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {RULES.map((rule) => {
          const ok = rule.test(value);
          return (
            <li
              key={rule.label}
              className={cn('text-[10.5px]', ok ? 'text-success' : 'text-muted-foreground')}
            >
              {ok ? '✓' : '○'} {rule.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
