'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { BadgeCheck, MailWarning } from 'lucide-react';
import { toast } from 'sonner';
import type { Customer } from '@/types';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { CheckboxField } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { Alert } from '@/components/ui/alert';

/**
 * Profile details.
 *
 * The email address is shown but not editable here. Changing the address an
 * account signs in with has to go through a verification of the *new* address —
 * otherwise a typo, or someone else at a shared computer, locks the owner out
 * of their own account. That flow belongs on the security page.
 */
export function ProfileForm({ customer }: { customer: Customer }) {
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [marketing, setMarketing] = React.useState(customer.acceptsMarketing);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/account/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: String(data.get('fullName') ?? '').trim(),
          phone: String(data.get('phone') ?? '').trim() || null,
          acceptsMarketing: marketing,
        }),
      });

      if (!response.ok) {
        setError('We could not save your changes. Please try again.');
        setSubmitting(false);
        return;
      }

      toast.success('Profile updated');
      router.refresh();
    } catch {
      setError('We could not reach the store. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <Field name="fullName" label="Full name" required>
        {(props) => <Input {...props} defaultValue={customer.fullName} autoComplete="name" />}
      </Field>

      <div>
        <Field name="email" label="Email address" hint="Change this from the Security page">
          {(props) => (
            <Input {...props} type="email" defaultValue={customer.email ?? ''} disabled />
          )}
        </Field>

        {/*
          An account made from a phone number has no address at all, and saying
          "not verified yet — check your inbox" about a blank box would send
          somebody looking through an inbox for a message nobody sent.
        */}
        <p className="mt-2 flex items-center gap-1.5 text-xs">
          {!customer.email ? (
            <>
              <MailWarning className="size-3.5 text-muted" aria-hidden />
              <span className="text-muted">
                No email yet — add one so we can send order confirmations
              </span>
            </>
          ) : customer.emailVerified ? (
            <>
              <BadgeCheck className="size-3.5 text-success" aria-hidden />
              <span className="text-success">Verified</span>
            </>
          ) : (
            <>
              <MailWarning className="size-3.5 text-warning" aria-hidden />
              <span className="text-warning">Not verified yet — check your inbox</span>
            </>
          )}
        </p>
      </div>

      <Field name="phone" label="Phone" hint="Used only for delivery updates">
        {(props) => (
          <Input {...props} type="tel" defaultValue={customer.phone ?? ''} autoComplete="tel" />
        )}
      </Field>

      <CheckboxField
        id="acceptsMarketing"
        checked={marketing}
        onCheckedChange={(value) => setMarketing(value === true)}
        label="Email me about new arrivals and sales"
        hint="Order and delivery emails are sent either way — those are not marketing."
      />

      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : null}

      <Button type="submit" disabled={submitting}>
        {submitting ? <Spinner /> : null}
        Save changes
      </Button>
    </form>
  );
}
