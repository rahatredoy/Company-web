'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export const OTP_LENGTH = 6;

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Fired when the last empty box is filled, including by paste. */
  onComplete?: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
}

const digitsOnly = (raw: string) => raw.replace(/\D/g, '').slice(0, OTP_LENGTH);

/**
 * Six single-character boxes that behave like one field.
 *
 * A code arrives by copy-paste at least as often as it does by typing, and it is
 * usually pasted onto whichever box happens to have focus — so every box accepts
 * a full code and distributes it, rather than swallowing the first digit. The
 * clipboard is stripped to digits first: a code copied out of the email brings
 * whitespace with it, and a plain `maxLength` field would truncate the good
 * digits off the end to make room for it.
 *
 * Copied from company-web on purpose; the two sign-ins are deployed separately.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  invalid,
  disabled,
  autoFocus,
  id = 'otp',
}: OtpInputProps) {
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);

  const focusBox = (index: number) => {
    refs.current[Math.min(Math.max(index, 0), OTP_LENGTH - 1)]?.focus();
  };

  const commit = (next: string, focusIndex: number) => {
    onChange(next);
    focusBox(focusIndex);
    if (next.length === OTP_LENGTH) onComplete?.(next);
  };

  const handleChange = (index: number, raw: string) => {
    const typed = digitsOnly(raw);
    if (!typed) return;

    // More than one digit means a paste (or an aggressive autofill): lay the
    // whole thing out from this box rather than keeping only the first digit.
    if (typed.length > 1) {
      const next = digitsOnly(value.slice(0, index) + typed);
      commit(next, next.length);
      return;
    }

    const chars = value.padEnd(OTP_LENGTH, ' ').split('');
    chars[index] = typed;
    commit(chars.join('').trimEnd(), index + 1);
  };

  const handleKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      // Backspace on an empty box steps back and clears the previous one, which
      // is what makes correcting a mistyped code feel like editing one field.
      const target = value[index] ? index : index - 1;
      if (target < 0) return;
      const chars = value.padEnd(OTP_LENGTH, ' ').split('');
      chars[target] = ' ';
      commit(chars.join('').trimEnd(), target);
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusBox(index - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusBox(index + 1);
    }
  };

  const handlePaste = (index: number, event: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = digitsOnly(event.clipboardData.getData('text'));
    if (!pasted) return;
    event.preventDefault();
    const next = digitsOnly(value.slice(0, index) + pasted);
    commit(next, next.length);
  };

  return (
    <div className="flex justify-center gap-2 sm:gap-2.5" role="group" aria-label="One-time code">
      {Array.from({ length: OTP_LENGTH }, (_, index) => (
        <input
          key={index}
          ref={(node) => {
            refs.current[index] = node;
          }}
          id={index === 0 ? id : `${id}-${index}`}
          // One `one-time-code` field per form, or browsers offer the same
          // autofill six times over.
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={OTP_LENGTH}
          value={value[index] ?? ''}
          disabled={disabled}
          autoFocus={autoFocus && index === 0}
          aria-invalid={invalid || undefined}
          aria-label={`Digit ${index + 1}`}
          onChange={(event) => handleChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={(event) => handlePaste(index, event)}
          onFocus={(event) => event.currentTarget.select()}
          className={cn(
            'size-11 rounded-lg border border-input bg-background text-center font-mono text-lg font-semibold text-foreground shadow-xs transition-colors sm:size-12',
            'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:outline-none',
            'disabled:cursor-not-allowed disabled:opacity-60',
            invalid && 'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/25',
          )}
        />
      ))}
    </div>
  );
}
