'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { supportTicketSchema, type SupportTicketInput } from '@/lib/validation';
import { api, errorMessage } from '@/lib/api';

export function NewTicketDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SupportTicketInput>({
    resolver: zodResolver(supportTicketSchema),
    defaultValues: { subject: '', priority: 'normal', message: '' },
  });

  const priority = watch('priority');

  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      const ticket = await api.post<{ id: string }>('/api/v1/client/support', values);
      toast.success('Ticket created', { description: 'Our team will reply shortly.' });
      setOpen(false);
      reset();
      router.push(`/dashboard/support/${ticket.id}`);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New ticket
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Open a support ticket</DialogTitle>
            <DialogDescription>
              Describe what is happening and we will get back to you.
            </DialogDescription>
          </DialogHeader>

          <div className="my-5 space-y-4">
            {error ? <Alert variant="danger">{error}</Alert> : null}

            <Field label="Subject" htmlFor="subject" required error={errors.subject?.message}>
              <Input id="subject" invalid={!!errors.subject} {...register('subject')} />
            </Field>

            <Field label="Priority" htmlFor="priority" required>
              <Select
                value={priority}
                onValueChange={(v) =>
                  setValue('priority', v as SupportTicketInput['priority'], { shouldValidate: true })
                }
              >
                <SelectTrigger id="priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label="Message" htmlFor="message" required error={errors.message?.message}>
              <Textarea id="message" rows={6} invalid={!!errors.message} {...register('message')} />
            </Field>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Create ticket
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
