'use client';

import * as React from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { publicEnv } from '@/lib/env';
import { subdomainSchema } from '@/lib/validation';
import { cn } from '@/lib/utils';

type Availability =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available' }
  | { state: 'taken'; message: string }
  | { state: 'invalid'; message: string };

/**
 * Live availability check. Convenience only — the API re-validates and holds a
 * UNIQUE constraint, and provisioning checks again before creating anything.
 */
export function SubdomainInput({
  value,
  onChange,
  onAvailabilityChange,
  invalid,
  id = 'slug',
}: {
  value: string;
  onChange: (value: string) => void;
  onAvailabilityChange?: (available: boolean) => void;
  invalid?: boolean;
  id?: string;
}) {
  const [availability, setAvailability] = React.useState<Availability>({ state: 'idle' });

  React.useEffect(() => {
    if (!value) {
      setAvailability({ state: 'idle' });
      onAvailabilityChange?.(false);
      return;
    }

    const parsed = subdomainSchema.safeParse(value);
    if (!parsed.success) {
      setAvailability({ state: 'invalid', message: parsed.error.issues[0]?.message ?? 'Invalid subdomain.' });
      onAvailabilityChange?.(false);
      return;
    }

    setAvailability({ state: 'checking' });
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const result = await api.get<{ available: boolean; reason?: string }>(
          '/api/v1/public/subdomain/check',
          { query: { value: parsed.data }, signal: controller.signal },
        );
        if (result.available) {
          setAvailability({ state: 'available' });
          onAvailabilityChange?.(true);
        } else {
          setAvailability({ state: 'taken', message: result.reason ?? 'This address is already taken.' });
          onAvailabilityChange?.(false);
        }
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') return;
        setAvailability({ state: 'idle' });
        onAvailabilityChange?.(false);
      }
    }, 450);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // onAvailabilityChange is intentionally excluded — parents pass inline callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="space-y-2">
      <div
        className={cn(
          'flex items-stretch overflow-hidden rounded-lg border border-input bg-background transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25',
          (invalid || availability.state === 'taken' || availability.state === 'invalid') &&
            'border-destructive focus-within:border-destructive focus-within:ring-destructive/25',
        )}
      >
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value.toLowerCase().replace(/\s+/g, '-'))}
          placeholder="abc-fashion"
          autoComplete="off"
          spellCheck={false}
          className="rounded-none border-0 shadow-none focus-visible:ring-0"
        />
        <span className="flex items-center gap-2 border-l border-border bg-muted px-3 text-sm whitespace-nowrap text-muted-foreground">
          {availability.state === 'checking' ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : availability.state === 'available' ? (
            <Check className="size-3.5 text-success" aria-hidden />
          ) : availability.state === 'taken' || availability.state === 'invalid' ? (
            <X className="size-3.5 text-destructive" aria-hidden />
          ) : null}
          .{publicEnv.rootDomain}
        </span>
      </div>

      <p
        className={cn(
          'text-xs',
          availability.state === 'available'
            ? 'text-success'
            : availability.state === 'taken' || availability.state === 'invalid'
              ? 'text-destructive'
              : 'text-muted-foreground',
        )}
        role={availability.state === 'taken' || availability.state === 'invalid' ? 'alert' : undefined}
      >
        {availability.state === 'available'
          ? `${value}.${publicEnv.rootDomain} is available.`
          : availability.state === 'taken' || availability.state === 'invalid'
            ? availability.message
            : `Your store will be live at ${value || 'your-store'}.${publicEnv.rootDomain}. You can connect your own domain later.`}
      </p>
    </div>
  );
}
