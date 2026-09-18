'use client';

import * as React from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

/**
 * Quantity control.
 *
 * Clamps to the product's own minimum and maximum, and to whatever stock is
 * left. Those bounds are advisory here — the server re-checks every one of them
 * when the line is added and again at checkout, because a control that only
 * exists in the browser is a suggestion.
 *
 * The value is a real `<input type="number">`, so it can be typed into and
 * submitted. Buttons alone force forty taps to order forty of something.
 */
export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max,
  disabled = false,
  size = 'md',
  label: labelProp,
  className,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number | null;
  disabled?: boolean;
  size?: 'sm' | 'md';
  label?: string;
  className?: string;
}) {
  const t = useT();
  const label = labelProp ?? t('Quantity');
  const id = React.useId();
  const ceiling = max ?? Number.MAX_SAFE_INTEGER;

  const clamp = React.useCallback(
    (next: number) => Math.min(ceiling, Math.max(min, Number.isFinite(next) ? Math.trunc(next) : min)),
    [ceiling, min],
  );

  const atMin = value <= min;
  const atMax = value >= ceiling;
  const small = size === 'sm';

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-(--radius-button) border border-border-strong bg-surface',
        disabled && 'opacity-50',
        className,
      )}
    >
      <StepButton
        icon={Minus}
        label={t('Decrease {label}', { label: label.toLowerCase() })}
        onClick={() => onChange(clamp(value - 1))}
        disabled={disabled || atMin}
        small={small}
      />

      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max ?? undefined}
        disabled={disabled}
        onChange={(event) => onChange(clamp(Number.parseInt(event.target.value, 10)))}
        // A blur with an empty or out-of-range box must land on something valid
        // rather than leaving the field showing a quantity nothing can honour.
        onBlur={(event) => onChange(clamp(Number.parseInt(event.target.value, 10)))}
        className={cn(
          'w-11 border-x border-border-strong bg-transparent text-center text-sm font-medium tabular-nums outline-none',
          'focus-visible:bg-surface-alt',
          '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          small ? 'h-9' : 'h-11',
        )}
      />

      <StepButton
        icon={Plus}
        label={t('Increase {label}', { label: label.toLowerCase() })}
        onClick={() => onChange(clamp(value + 1))}
        disabled={disabled || atMax}
        small={small}
      />
    </div>
  );
}

function StepButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  small,
}: {
  icon: typeof Minus;
  label: string;
  onClick: () => void;
  disabled: boolean;
  small: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'grid shrink-0 place-items-center text-foreground transition-colors hover:bg-surface-alt',
        'disabled:pointer-events-none disabled:text-subtle',
        small ? 'size-9' : 'size-11',
      )}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
