'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, errorMessage } from '@/lib/api';
import { BUSINESS_TYPES, COUNTRIES } from '@/lib/content';
import { businessInfoSchema, type BusinessInfoInput } from '@/lib/validation';
import type { BusinessProfileView } from '@/lib/types';

/**
 * Invoice identity. Signup only captures the business name, so this is where the
 * rest is filled in — and because invoices snapshot these details when they are
 * issued, editing here changes future invoices and never rewrites past ones.
 */
export function BusinessDetailsForm({ profile }: { profile: BusinessProfileView | null }) {
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<BusinessInfoInput>({
    resolver: zodResolver(businessInfoSchema),
    defaultValues: {
      businessName: profile?.businessName ?? '',
      ownerName: profile?.ownerName ?? '',
      businessEmail: profile?.businessEmail ?? '',
      businessPhone: profile?.businessPhone ?? '',
      country: profile?.country ?? '',
      address: profile?.address ?? '',
      businessType: (profile?.businessType as BusinessInfoInput['businessType']) ?? '',
    },
  });

  const country = watch('country');
  const businessType = watch('businessType');

  const submit = async (values: BusinessInfoInput) => {
    setError(null);
    setSaved(false);
    try {
      await api.put('/api/v1/client/business', values);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Business details</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(submit)} className="space-y-5" noValidate>
          {error ? <Alert variant="danger">{error}</Alert> : null}
          {saved ? <Alert variant="success">Saved. New invoices will use these details.</Alert> : null}

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Business name" htmlFor="businessName" required error={errors.businessName?.message}>
              <Input id="businessName" invalid={!!errors.businessName} {...register('businessName')} />
            </Field>

            <Field label="Owner name" htmlFor="ownerName" required error={errors.ownerName?.message}>
              <Input id="ownerName" invalid={!!errors.ownerName} {...register('ownerName')} />
            </Field>

            <Field label="Billing email" htmlFor="businessEmail" required error={errors.businessEmail?.message}>
              <Input
                id="businessEmail"
                type="email"
                invalid={!!errors.businessEmail}
                {...register('businessEmail')}
              />
            </Field>

            <Field label="Phone" htmlFor="businessPhone" error={errors.businessPhone?.message}>
              <Input id="businessPhone" type="tel" invalid={!!errors.businessPhone} {...register('businessPhone')} />
            </Field>

            <Field label="Country" htmlFor="country" error={errors.country?.message}>
              <Select value={country || ''} onValueChange={(v) => setValue('country', v, { shouldValidate: true })}>
                <SelectTrigger id="country" invalid={!!errors.country}>
                  <SelectValue placeholder="Select a country" />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Business type" htmlFor="businessType" error={errors.businessType?.message}>
              <Select
                value={businessType || ''}
                onValueChange={(v) =>
                  setValue('businessType', v as BusinessInfoInput['businessType'], { shouldValidate: true })
                }
              >
                <SelectTrigger id="businessType" invalid={!!errors.businessType}>
                  <SelectValue placeholder="Select a type" />
                </SelectTrigger>
                <SelectContent>
                  {BUSINESS_TYPES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field
            label="Billing address"
            htmlFor="address"
            error={errors.address?.message}
            hint="Printed on your invoices."
          >
            <Textarea id="address" rows={3} invalid={!!errors.address} {...register('address')} />
          </Field>

          <div className="flex justify-end">
            <Button type="submit" loading={isSubmitting}>
              Save details
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
