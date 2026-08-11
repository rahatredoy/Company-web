'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { supportReplySchema } from '@/lib/validation';
import { api, errorMessage } from '@/lib/api';

type Values = z.infer<typeof supportReplySchema>;

export function TicketReplyForm({ ticketId, disabled }: { ticketId: string; disabled?: boolean }) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(supportReplySchema), defaultValues: { message: '' } });

  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      await api.post(`/api/v1/client/support/${ticketId}/reply`, values);
      reset();
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  if (disabled) {
    return (
      <Alert variant="info">
        This ticket is closed. Open a new ticket if you need more help.
      </Alert>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      {error ? <Alert variant="danger">{error}</Alert> : null}
      <Field label="Reply" htmlFor="message" error={errors.message?.message}>
        <Textarea id="message" rows={4} placeholder="Write your reply…" {...register('message')} />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" loading={isSubmitting}>
          <Send /> Send reply
        </Button>
      </div>
    </form>
  );
}
