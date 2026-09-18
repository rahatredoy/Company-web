import * as React from 'react';
import { cn } from '@/lib/utils';
import { TranslatedText } from './translated-text';

/**
 * Label + control + error + hint, wired together.
 *
 * Exists because the wiring is the part that gets forgotten. A field needs
 * `htmlFor`/`id` to match, `aria-describedby` to name both the hint and the
 * error, and `aria-invalid` to flip — four attributes across three elements,
 * and a form with twelve inputs is forty-eight chances to miss one.
 *
 * The control is passed as a render function receiving the props it must
 * spread, so it is impossible to render a `Field` whose input is unlabelled.
 *
 * **Deliberately not a Client Component**, and the id is derived from `name`
 * rather than from `useId`. A render prop is a function, and a function cannot
 * cross the server/client boundary — marking this `'use client'` made it
 * unusable from any Server Component, which broke `/track-order` with
 * "Functions are not valid as a child of Client Components". Without the
 * directive it compiles into whichever graph imports it and works on both
 * sides. Field names are already unique within a form, so they make a perfectly
 * good id.
 *
 * Never uses the placeholder as the label: a placeholder disappears the moment
 * someone types, which is exactly when they most need to know what the box was
 * for.
 */
export function Field({
  name,
  label,
  hint,
  error,
  required = false,
  className,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: (props: {
    id: string;
    name: string;
    'aria-describedby': string | undefined;
    'aria-invalid': boolean | undefined;
    required: boolean;
  }) => React.ReactNode;
}) {
  const id = `field-${name}`;
  const hintId = hint && !error ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
        {/*
          The asterisk carries a real word for screen readers. A red star alone
          conveys "required" by convention and by colour, which is exactly the
          pair of signals the accessibility rules say not to rely on.
        */}
        {required ? (
          <>
            <span aria-hidden className="ml-0.5 text-error">
              *
            </span>
            <span className="sr-only">
              {' '}
              <TranslatedText text="(required)" />
            </span>
          </>
        ) : null}
      </label>

      {children({
        id,
        name,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        required,
      })}

      {hintId ? (
        <p id={hintId} className="text-xs text-subtle">
          {hint}
        </p>
      ) : null}

      {errorId ? (
        <p id={errorId} className="text-xs font-medium text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
