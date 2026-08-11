'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { contactSchema } from '@/lib/validation';
import { api, errorMessage } from '@/lib/api';
import { toast } from '@/components/ui/toaster';

type ContactValues = z.infer<typeof contactSchema>;

export function ContactForm() {
  const [sent, setSent] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContactValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: { name: '', email: '', company: '', message: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.post('/api/v1/public/contact', values);
      setSent(true);
      reset();
      toast.success('Message sent', { description: 'Our team will get back to you shortly.' });
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  if (sent) {
    return (
      <Alert variant="success" title="Thanks — your message is on its way">
        We reply to most messages within one business day.
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {formError ? <Alert variant="danger">{formError}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" htmlFor="name" required error={errors.name?.message}>
          <Input id="name" autoComplete="name" invalid={!!errors.name} {...register('name')} />
        </Field>
        <Field label="Work email" htmlFor="email" required error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" invalid={!!errors.email} {...register('email')} />
        </Field>
      </div>

      <Field label="Company" htmlFor="company" error={errors.company?.message}>
        <Input id="company" autoComplete="organization" invalid={!!errors.company} {...register('company')} />
      </Field>

      <Field label="How can we help?" htmlFor="message" required error={errors.message?.message}>
        <Textarea id="message" rows={6} invalid={!!errors.message} {...register('message')} />
      </Field>

      <Button type="submit" size="lg" loading={isSubmitting} className="w-full sm:w-auto">
        Send message
      </Button>
    </form>
  );
}
