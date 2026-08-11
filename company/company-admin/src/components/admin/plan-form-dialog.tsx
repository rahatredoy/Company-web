'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
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
import { api, errorMessage } from '@/lib/api';
import type { Plan } from '@/lib/types';

const money = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Enter a valid amount.');

/** Blank means "unlimited" for every limit field. */
const optionalLimit = z
  .string()
  .trim()
  .refine((v) => v === '' || /^\d+$/.test(v), 'Enter a whole number, or leave blank for unlimited.');

const planSchema = z.object({
  name: z.string().trim().min(2, 'Enter a plan name.').max(60),
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,40}$/, 'Lowercase letters, numbers and hyphens only.'),
  description: z.string().trim().max(200).optional(),
  monthlyPrice: money,
  yearlyPrice: money,
  productLimit: optionalLimit,
  adminLimit: optionalLimit,
  storageLimitMb: optionalLimit,
  customDomainEnabled: z.boolean(),
  customAdminDomainEnabled: z.boolean(),
  reportsEnabled: z.boolean(),
  analyticsEnabled: z.boolean(),
  supportLevel: z.enum(['email', 'priority', 'dedicated']),
  isFeatured: z.boolean(),
  sortOrder: z.string().trim().regex(/^\d{1,3}$/, 'Enter a number.'),
});

type PlanValues = z.infer<typeof planSchema>;

function toValues(plan?: Plan): PlanValues {
  return {
    name: plan?.name ?? '',
    code: plan?.code ?? '',
    description: plan?.description ?? '',
    monthlyPrice: plan?.monthlyPrice ?? '0',
    yearlyPrice: plan?.yearlyPrice ?? '0',
    productLimit: plan?.productLimit === null || plan?.productLimit === undefined ? '' : String(plan.productLimit),
    adminLimit: plan?.adminLimit === null || plan?.adminLimit === undefined ? '' : String(plan.adminLimit),
    storageLimitMb:
      plan?.storageLimitMb === null || plan?.storageLimitMb === undefined ? '' : String(plan.storageLimitMb),
    customDomainEnabled: plan?.customDomainEnabled ?? false,
    customAdminDomainEnabled: plan?.customAdminDomainEnabled ?? false,
    reportsEnabled: plan?.reportsEnabled ?? false,
    analyticsEnabled: plan?.analyticsEnabled ?? false,
    supportLevel: plan?.supportLevel ?? 'email',
    isFeatured: plan?.isFeatured ?? false,
    sortOrder: String(plan?.sortOrder ?? 0),
  };
}

export function PlanFormDialog({ plan }: { plan?: Plan }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const editing = Boolean(plan);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PlanValues>({ resolver: zodResolver(planSchema), defaultValues: toValues(plan) });

  React.useEffect(() => {
    if (open) reset(toValues(plan));
  }, [open, plan, reset]);

  const toggle = (key: keyof PlanValues) => (
    <Switch checked={Boolean(watch(key))} onCheckedChange={(checked) => setValue(key, checked)} />
  );

  const submit = handleSubmit(async (values) => {
    setError(null);
    const payload = {
      ...values,
      description: values.description || null,
      productLimit: values.productLimit === '' ? null : Number(values.productLimit),
      adminLimit: values.adminLimit === '' ? null : Number(values.adminLimit),
      storageLimitMb: values.storageLimitMb === '' ? null : Number(values.storageLimitMb),
      sortOrder: Number(values.sortOrder),
    };

    try {
      if (editing) await api.put(`/api/v1/admin/plans/${plan!.id}`, payload);
      else await api.post('/api/v1/admin/plans', payload);
      toast.success(editing ? 'Plan updated' : 'Plan created');
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <Button variant="ghost" size="sm">
            <Pencil /> Edit
          </Button>
        ) : (
          <Button>
            <Plus /> Create plan
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="max-h-[88dvh] max-w-2xl overflow-y-auto">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${plan!.name}` : 'Create a plan'}</DialogTitle>
            <DialogDescription>
              Pricing shown on the website comes from here — nothing is hard-coded in the frontend.
            </DialogDescription>
          </DialogHeader>

          <div className="my-5 space-y-4">
            {error ? <Alert variant="danger">{error}</Alert> : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="name" required error={errors.name?.message}>
                <Input id="name" invalid={!!errors.name} {...register('name')} />
              </Field>
              <Field
                label="Code"
                htmlFor="code"
                required
                error={errors.code?.message}
                hint="Stable identifier used in links, e.g. business"
              >
                <Input id="code" invalid={!!errors.code} disabled={editing} {...register('code')} />
              </Field>
            </div>

            <Field label="Description" htmlFor="description" error={errors.description?.message}>
              <Textarea id="description" rows={2} {...register('description')} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Monthly price" htmlFor="monthlyPrice" required error={errors.monthlyPrice?.message}>
                <Input id="monthlyPrice" inputMode="decimal" invalid={!!errors.monthlyPrice} {...register('monthlyPrice')} />
              </Field>
              <Field label="Yearly price" htmlFor="yearlyPrice" required error={errors.yearlyPrice?.message}>
                <Input id="yearlyPrice" inputMode="decimal" invalid={!!errors.yearlyPrice} {...register('yearlyPrice')} />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Product limit" htmlFor="productLimit" error={errors.productLimit?.message} hint="Blank = unlimited">
                <Input id="productLimit" inputMode="numeric" {...register('productLimit')} />
              </Field>
              <Field label="Admin limit" htmlFor="adminLimit" error={errors.adminLimit?.message} hint="Blank = unlimited">
                <Input id="adminLimit" inputMode="numeric" {...register('adminLimit')} />
              </Field>
              <Field label="Storage (MB)" htmlFor="storageLimitMb" error={errors.storageLimitMb?.message} hint="Blank = unlimited">
                <Input id="storageLimitMb" inputMode="numeric" {...register('storageLimitMb')} />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Support level" htmlFor="supportLevel" required>
                <Select
                  value={watch('supportLevel')}
                  onValueChange={(v) => setValue('supportLevel', v as PlanValues['supportLevel'])}
                >
                  <SelectTrigger id="supportLevel">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email support</SelectItem>
                    <SelectItem value="priority">Priority support</SelectItem>
                    <SelectItem value="dedicated">Dedicated 24/7</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Sort order" htmlFor="sortOrder" required error={errors.sortOrder?.message}>
                <Input id="sortOrder" inputMode="numeric" {...register('sortOrder')} />
              </Field>
            </div>

            <div className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
              {(
                [
                  ['customDomainEnabled', 'Custom storefront domain'],
                  ['customAdminDomainEnabled', 'Custom admin domain'],
                  ['reportsEnabled', 'Reports'],
                  ['analyticsEnabled', 'Analytics'],
                  ['isFeatured', 'Highlight as most popular'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-3 text-sm">
                  {label}
                  {toggle(key)}
                </label>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {editing ? 'Save changes' : 'Create plan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PlanStatusToggle({ plan }: { plan: Plan }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      await api.post(`/api/v1/admin/plans/${plan.id}/status`, { status: enabled ? 'active' : 'disabled' });
      toast.success(enabled ? 'Plan enabled' : 'Plan disabled');
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Switch
      checked={plan.status === 'active'}
      onCheckedChange={toggle}
      disabled={busy}
      aria-label={`${plan.status === 'active' ? 'Disable' : 'Enable'} ${plan.name}`}
    />
  );
}
