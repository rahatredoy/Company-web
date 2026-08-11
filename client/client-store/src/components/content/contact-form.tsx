'use client';

import * as React from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';

/**
 * Contact form.
 *
 * On success it replaces itself with a confirmation rather than clearing and
 * showing a toast — a cleared form looks like a submission that failed, and
 * this is the one form where people genuinely worry whether it went through.
 */
export function ContactForm() {
  const [state, setState] = React.useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state === 'sending') return;

    const data = new FormData(event.currentTarget);
    const payload = {
      name: String(data.get('name') ?? '').trim(),
      email: String(data.get('email') ?? '').trim(),
      phone: String(data.get('phone') ?? '').trim() || undefined,
      subject: String(data.get('subject') ?? '').trim(),
      message: String(data.get('message') ?? '').trim(),
    };

    setState('sending');
    setFieldErrors({});

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { details?: Record<string, string> }
          | null;
        if (body?.details) setFieldErrors(body.details);
        setState('error');
        return;
      }

      setState('sent');
    } catch {
      setState('error');
    }
  };

  if (state === 'sent') {
    return (
      <Alert tone="success" title="Message sent">
        Thank you — we have your message and will reply within one working day.
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field name="name" label="Your name" required error={fieldErrors.name}>
          {(props) => <Input {...props} autoComplete="name" />}
        </Field>

        <Field name="email" label="Email" required error={fieldErrors.email}>
          {(props) => <Input {...props} type="email" autoComplete="email" />}
        </Field>

        <Field name="phone" label="Phone" hint="Optional">
          {(props) => <Input {...props} type="tel" autoComplete="tel" />}
        </Field>

        <Field name="subject" label="Subject" required error={fieldErrors.subject}>
          {(props) => <Input {...props} placeholder="What is this about?" />}
        </Field>
      </div>

      <Field name="message" label="Message" required error={fieldErrors.message}>
        {(props) => (
          <Textarea {...props} rows={6} placeholder="Tell us what you need. Include an order number if you have one." />
        )}
      </Field>

      {state === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <p role="alert" className="text-sm font-medium text-error">
          We could not send your message. Please try again, or email us directly.
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={state === 'sending'}>
        {state === 'sending' ? <Spinner /> : <Send aria-hidden />}
        Send message
      </Button>
    </form>
  );
}
