'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight, Check, CreditCard, Lock, Rocket, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { OTP_LENGTH, OtpInput } from '@/components/auth/otp-input';
import { AddressChoice } from './address-choice';
import { SubdomainInput } from './subdomain-input';
import { SetupIllustration } from './store-illustrations';
import { ApiError, api, errorCode, errorMessage } from '@/lib/api';
import { publicEnv } from '@/lib/env';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { BillingGate } from '@/lib/billing-gate';
import {
  adminPanelSetupSchema,
  websiteSetupSchema,
  type AdminPanelSetupInput,
  type WebsiteSetupInput,
} from '@/lib/validation';
import type { OnboardingState } from '@/lib/types';

/** Matches the API's resend cooldown, so the link re-enables when it will work. */
const RESEND_COOLDOWN_SECONDS = 60;

const STEPS = ['Website', 'Admin panel', 'Verify'] as const;
type Step = 'intro' | 'website' | 'admin' | 'code';

/**
 * What the wizard is about to ask, spelled out before it asks. The fourth is
 * not a question — provisioning does it — but leaving it off would make the
 * store look like something the owner still has to build by hand.
 */
const SETUP_STEPS = [
  { title: 'Set up your website', description: 'Choose your store name and address' },
  { title: 'Configure admin panel', description: 'Its address, and the login that opens it' },
  { title: 'Verify your login', description: 'Enter the code we email to that address' },
  { title: 'Launch your store', description: 'We create the storefront, panel and database' },
] as const;

/** "ABC Fashion" -> "abc-fashion" */
function toSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40);
}

/**
 * Why `Start Setup` did nothing — asked at the moment it is pressed, not hidden
 * behind a padlock on the way in.
 *
 * The store page shows its whole setup unpaid on purpose: nobody can decide
 * whether to pay for something they have not been allowed to look at. This is the
 * one place the bill is enforced in the UI, and it names what is outstanding and
 * how much it is rather than saying "not allowed".
 */
function BillingFirstDialog({
  gate,
  open,
  onOpenChange,
}: {
  gate: BillingGate;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-primary-soft text-primary">
            <CreditCard className="size-5" aria-hidden />
          </span>
          <DialogTitle>
            {gate.stage === 'plan' ? 'Set up billing first' : 'Pay your bill first'}
          </DialogTitle>
          <DialogDescription>
            {gate.stage === 'plan'
              ? 'Choose a plan and settle its bill, and setup opens straight after. Your plan decides what your store can do — how many products, how many admins, and whether you can use your own domain.'
              : gate.isTrial
                ? `Your ${gate.planName ?? 'plan'} is on a free trial, so today's bill is ${formatMoney(gate.amountDue, gate.currency)}. It still has to go through checkout — that is what puts a card on file and lets us build your store.`
                : `Your ${gate.planName ?? 'plan'} is waiting on a bill of ${formatMoney(gate.amountDue, gate.currency)}. Your storefront, admin panel and your own database are created as soon as it clears.`}
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Nothing here is hidden in the meantime — every step above is exactly what setup will ask for.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep looking around
          </Button>
          <Button asChild>
            <Link href={gate.href}>
              {gate.label} <ArrowRight />
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stepper({ current }: { current: 0 | 1 | 2 }) {
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((label, index) => (
        <li key={label} className="flex flex-1 items-center gap-2">
          <span
            className={cn(
              'grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
              index < current
                ? 'bg-success text-success-foreground'
                : index === current
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground',
            )}
          >
            {index < current ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
          </span>
          <span
            className={cn(
              'text-xs font-medium whitespace-nowrap',
              index === current ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {label}
          </span>
          {index < STEPS.length - 1 ? <span className="h-px flex-1 bg-border" aria-hidden /> : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * Building a store, start to finish, on the page that owns it.
 *
 * Three questions in a fixed order — what customers see, how the owner gets in,
 * and a passcode proving the login they just chose is one they can actually
 * read. The last one is why this is a wizard rather than two independent forms:
 * nothing is provisioned until the code comes back, so a mistyped admin address
 * is caught while it is still only a draft.
 *
 * A settled bill gates all of it, but the intro is shown anyway when `gate` is
 * outstanding: the whole point of this page is to let someone see what they are
 * about to buy. Only `Start Setup` is refused, and it says why on the spot rather
 * than leaving a padlock to be guessed at. The API refuses every one of these
 * calls under the same rule, so this is a courtesy, not the enforcement.
 */
export function StoreSetupWizard({
  signup,
  accountEmail,
  gate,
}: {
  signup: OnboardingState | null;
  accountEmail: string;
  gate: BillingGate;
}) {
  const router = useRouter();

  const pending = signup?.adminPanel?.pendingVerification ?? null;
  const [step, setStep] = React.useState<Step>(pending ? 'code' : 'intro');
  const [sentTo, setSentTo] = React.useState<string | null>(pending?.sentTo ?? null);
  // The address just chosen, so step 2 can show the admin panel URL it implies
  // without waiting for the server data behind `signup` to be re-read.
  const [slug, setSlug] = React.useState(signup?.website?.slug ?? '');
  const [billingAsked, setBillingAsked] = React.useState(false);

  function start() {
    // Nothing can be saved before the bill settles, so the button explains that
    // instead of opening a form whose every submit would come back a 409.
    if (!gate.complete) {
      setBillingAsked(true);
      return;
    }
    // Whichever half is already saved is not asked for twice — someone who got
    // as far as the admin panel last time resumes there.
    setStep(signup?.website?.configured && !signup?.adminPanel?.configured ? 'admin' : 'website');
  }

  if (step === 'intro' || !gate.complete) {
    const done = [
      signup?.website?.configured ?? false,
      signup?.adminPanel?.configured ?? false,
      signup?.adminPanel?.verified ?? false,
      false,
    ];

    // The step the wizard would open on, so the list points at the same place
    // the button does.
    const current = done.findIndex((value) => !value);

    return (
      <>
        <BillingFirstDialog gate={gate} open={billingAsked} onOpenChange={setBillingAsked} />

        <Card>
          <CardContent className="grid gap-10 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:p-10">
            <div className="flex flex-col justify-center gap-6">
              <span className="grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary">
                <Rocket className="size-7" aria-hidden />
              </span>

              <div className="space-y-3">
                <h2 className="text-3xl font-bold tracking-tight">Let&apos;s Build Your Store</h2>
                <p className="max-w-md text-[14px] leading-relaxed text-muted-foreground">
                  Create your store in a few easy steps. You&apos;ll get a beautiful website and admin panel
                  to manage your business.
                </p>
              </div>

              <div className="space-y-2.5">
                <Button size="lg" onClick={start}>
                  Start Setup <ArrowRight />
                </Button>
                {gate.complete ? null : (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Lock className="size-3.5 shrink-0" aria-hidden />
                    Setup starts once your bill is paid — everything it builds is listed here.
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-8 lg:border-l lg:border-border lg:pl-10">
              <ol className="min-w-0 flex-1">
                {SETUP_STEPS.map((entry, index) => (
                  <li key={entry.title} className="relative flex gap-4 pb-6 last:pb-0">
                    {index < SETUP_STEPS.length - 1 ? (
                      <span
                        className="absolute top-9 bottom-1 left-4 w-px border-l border-dashed border-border"
                        aria-hidden
                      />
                    ) : null}

                    <span
                      className={cn(
                        'relative grid size-8 shrink-0 place-items-center rounded-full text-[12px] font-semibold',
                        done[index]
                          ? 'bg-success text-success-foreground'
                          : index === current
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {done[index] ? <Check className="size-4" strokeWidth={3} aria-hidden /> : index + 1}
                    </span>

                    <div className="min-w-0 space-y-1 pt-1">
                      <p className="text-[14px] font-semibold">{entry.title}</p>
                      <p className="text-[12px] text-muted-foreground">{entry.description}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="hidden shrink-0 xl:block">
                <SetupIllustration className="w-[250px]" />
              </div>
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-6 p-5 sm:p-6">
        <Stepper current={step === 'website' ? 0 : step === 'admin' ? 1 : 2} />

        {step === 'website' ? (
          <WebsiteStep
            signup={signup}
            onDone={(saved) => {
              setSlug(saved);
              setStep('admin');
            }}
            onBack={() => setStep('intro')}
          />
        ) : null}

        {step === 'admin' ? (
          <AdminStep
            signup={signup}
            slug={slug}
            accountEmail={accountEmail}
            onBack={() => setStep('website')}
            onSent={(address) => {
              setSentTo(address);
              setStep('code');
            }}
          />
        ) : null}

        {step === 'code' ? (
          <VerifyStep
            sentTo={sentTo}
            onBack={() => setStep('admin')}
            onVerified={() => router.refresh()}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Step 1 — the store's name and the address customers shop at. */
function WebsiteStep({
  signup,
  onDone,
  onBack,
}: {
  signup: OnboardingState | null;
  onDone: (slug: string) => void;
  onBack: () => void;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]> | undefined>();

  const website = signup?.website ?? null;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<WebsiteSetupInput>({
    resolver: zodResolver(websiteSetupSchema),
    defaultValues: {
      businessName: website?.businessName ?? '',
      slug: website?.slug ?? '',
      domainMode: website?.customDomain ? 'custom' : 'platform',
      customDomain: website?.customDomain ?? '',
    },
  });

  const [slugTouched, setSlugTouched] = React.useState(Boolean(website?.slug));
  const [available, setAvailable] = React.useState(Boolean(website?.slug));

  const businessName = watch('businessName') ?? '';
  const slug = watch('slug') ?? '';
  const domainMode = watch('domainMode');

  // Suggest the address from the store name until the owner edits it.
  React.useEffect(() => {
    if (slugTouched) return;
    setValue('slug', toSlug(businessName), { shouldValidate: false });
  }, [businessName, slugTouched, setValue]);

  const submit = handleSubmit(async (values) => {
    setError(null);
    setFieldErrors(undefined);
    try {
      await api.post('/api/v1/client/onboarding/website', {
        businessName: values.businessName,
        slug: values.slug,
        storefrontDomain: values.domainMode === 'custom' ? values.customDomain : '',
      });
      onDone(values.slug);
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.details) setFieldErrors(err.details);
    }
  });

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <div>
        <h2 className="text-base font-semibold">Set up your store website</h2>
        <p className="text-sm text-muted-foreground">What your store is called, and where customers shop.</p>
      </div>

      {error ? <Alert variant="danger">{error}</Alert> : null}

      <Field
        label="Store name"
        htmlFor="businessName"
        required
        error={errors.businessName?.message ?? fieldErrors?.businessName?.[0]}
        hint="Shown to your customers and on your invoices. You can change it later."
      >
        <Input id="businessName" invalid={!!errors.businessName} {...register('businessName')} />
      </Field>

      <section className="space-y-3">
        <AddressChoice
          label="Store address"
          value={domainMode}
          onChange={(value) => setValue('domainMode', value, { shouldValidate: true })}
          platformLabel={`Free ${publicEnv.rootDomain} address`}
          disabled={!signup?.planFeatures?.customDomainEnabled}
        />

        {domainMode === 'custom' ? (
          <Field
            label="Your domain"
            htmlFor="customDomain"
            required
            error={errors.customDomain?.message ?? fieldErrors?.storefrontDomain?.[0]}
            hint="We will give you the DNS record to add once your store is created."
          >
            <Input
              id="customDomain"
              placeholder="abcfashion.com"
              autoComplete="off"
              spellCheck={false}
              invalid={!!errors.customDomain}
              {...register('customDomain')}
            />
          </Field>
        ) : null}

        <Field
          label={domainMode === 'custom' ? 'Platform address' : ''}
          htmlFor="slug"
          error={errors.slug?.message ?? fieldErrors?.slug?.[0]}
          hint={
            domainMode === 'custom'
              ? 'Your store keeps this address too — it stays reachable while your own domain is being verified.'
              : undefined
          }
        >
          <SubdomainInput
            id="slug"
            value={slug}
            invalid={!!errors.slug}
            onChange={(value) => {
              setSlugTouched(true);
              setValue('slug', value, { shouldValidate: true });
            }}
            onAvailabilityChange={setAvailable}
          />
        </Field>

        <p className="text-xs text-muted-foreground">
          This address is permanent — your store&apos;s database and sign-in sessions are keyed to it.
        </p>
      </section>

      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft /> Back
        </Button>
        <Button type="submit" size="lg" loading={isSubmitting} disabled={!available}>
          Next <ArrowRight />
        </Button>
      </div>
    </form>
  );
}

/** Step 2 — the admin panel's address and the login that opens it. */
function AdminStep({
  signup,
  slug,
  accountEmail,
  onSent,
  onBack,
}: {
  signup: OnboardingState | null;
  slug: string;
  accountEmail: string;
  onSent: (sentTo: string) => void;
  onBack: () => void;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]> | undefined>();

  const adminPanel = signup?.adminPanel ?? null;
  const storeSlug = slug || signup?.website?.slug || 'your-store';

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<AdminPanelSetupInput>({
    resolver: zodResolver(adminPanelSetupSchema),
    defaultValues: {
      domainMode: adminPanel?.customDomain ? 'custom' : 'platform',
      customDomain: adminPanel?.customDomain ?? '',
      adminEmail: adminPanel?.adminEmail ?? accountEmail,
      adminPassword: '',
      confirmPassword: '',
    },
  });

  const domainMode = watch('domainMode');

  const submit = handleSubmit(async (values) => {
    setError(null);
    setFieldErrors(undefined);
    try {
      const result = await api.post<{ sentTo: string }>('/api/v1/client/onboarding/admin-panel', {
        adminEmail: values.adminEmail,
        adminPassword: values.adminPassword,
        adminDomain: values.domainMode === 'custom' ? values.customDomain : '',
      });
      onSent(result?.sentTo ?? values.adminEmail);
    } catch (err) {
      // A code is already in flight for this address — the cooldown, not a
      // failure, so carry on to the step that accepts it.
      if (errorCode(err) === 'OTP_RESEND_TOO_SOON') {
        onSent(values.adminEmail);
        return;
      }
      setError(errorMessage(err));
      if (err instanceof ApiError && err.details) setFieldErrors(err.details);
    }
  });

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <div>
        <h2 className="text-base font-semibold">Set up your admin dashboard</h2>
        <p className="text-sm text-muted-foreground">
          Where you manage products, orders and customers — and the login that opens it.
        </p>
      </div>

      {error ? <Alert variant="danger">{error}</Alert> : null}

      <section className="space-y-3">
        <AddressChoice
          label="Admin panel address"
          value={domainMode}
          onChange={(value) => setValue('domainMode', value, { shouldValidate: true })}
          platformLabel={`admin.${storeSlug}.${publicEnv.rootDomain}`}
          disabled={!signup?.planFeatures?.customAdminDomainEnabled}
        />

        {domainMode === 'custom' ? (
          <Field
            label="Your admin domain"
            htmlFor="adminCustomDomain"
            required
            error={errors.customDomain?.message ?? fieldErrors?.adminDomain?.[0]}
            hint="A subdomain you control, for example admin.abcfashion.com."
          >
            <Input
              id="adminCustomDomain"
              placeholder="admin.abcfashion.com"
              autoComplete="off"
              spellCheck={false}
              invalid={!!errors.customDomain}
              {...register('customDomain')}
            />
          </Field>
        ) : null}
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-muted/30 p-4">
        <div>
          <h3 className="text-sm font-semibold">Admin panel login</h3>
          <p className="text-xs text-muted-foreground">
            The only account that can sign in to your store admin panel. It is separate from the account
            you use here — changing one never changes the other.
          </p>
        </div>

        <Field
          label="Email"
          htmlFor="adminEmail"
          required
          error={errors.adminEmail?.message ?? fieldErrors?.adminEmail?.[0]}
          hint="We send a 6-digit code here to confirm it before your store is created."
        >
          <Input
            id="adminEmail"
            type="email"
            autoComplete="off"
            invalid={!!errors.adminEmail}
            {...register('adminEmail')}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Password"
            htmlFor="adminPassword"
            required
            error={errors.adminPassword?.message ?? fieldErrors?.adminPassword?.[0]}
            hint="At least 10 characters, with a number and a symbol."
          >
            <Input
              id="adminPassword"
              type="password"
              autoComplete="new-password"
              invalid={!!errors.adminPassword}
              {...register('adminPassword')}
            />
          </Field>

          <Field
            label="Confirm password"
            htmlFor="confirmPassword"
            required
            error={errors.confirmPassword?.message}
          >
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              invalid={!!errors.confirmPassword}
              {...register('confirmPassword')}
            />
          </Field>
        </div>

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden />
          We store only a hash of this password and never show it back. You can reset it from this page
          later.
        </p>
      </section>

      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft /> Back
        </Button>
        <Button type="submit" size="lg" loading={isSubmitting}>
          Send code <ArrowRight />
        </Button>
      </div>
    </form>
  );
}

/** Step 3 — the passcode, and the moment the store is actually built. */
function VerifyStep({
  sentTo,
  onVerified,
  onBack,
}: {
  sentTo: string | null;
  onVerified: () => void;
  onBack: () => void;
}) {
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [cooldown, setCooldown] = React.useState(RESEND_COOLDOWN_SECONDS);

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function submit(value: string) {
    if (value.length !== OTP_LENGTH || submitting || done) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await api.post('/api/v1/client/onboarding/admin-panel/verify', { code: value });
      // Provisioning has started. The page re-reads the store and takes over
      // with the progress view, so this step stays put and says so.
      setDone(true);
      onVerified();
    } catch (err) {
      setCode('');
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function resend() {
    if (cooldown > 0) return;
    setError(null);
    setNotice(null);
    try {
      await api.post('/api/v1/client/onboarding/admin-panel/resend');
      setCode('');
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setNotice('A new code is on its way.');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (done) {
    return (
      <div className="space-y-3 py-4 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-success-soft text-success">
          <Check className="size-6" strokeWidth={3} aria-hidden />
        </span>
        <h2 className="text-base font-semibold">Setup complete</h2>
        <p className="text-sm text-muted-foreground">
          We are creating your storefront, admin panel and database now.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">Confirm your admin login</h2>
        <p className="text-sm text-muted-foreground">
          Enter the 6-digit code we sent to{' '}
          <span className="font-medium text-foreground">{sentTo ?? 'your admin email'}</span>. Your store
          is created as soon as it checks out.
        </p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit(code);
        }}
        className="space-y-5"
        noValidate
      >
        {error ? <Alert variant="danger">{error}</Alert> : null}
        {notice ? <Alert variant="success">{notice}</Alert> : null}

        <OtpInput
          value={code}
          onChange={setCode}
          onComplete={(value) => void submit(value)}
          invalid={!!error}
          disabled={submitting}
          autoFocus
        />

        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={submitting}
          disabled={code.length !== OTP_LENGTH}
        >
          Verify and create my store
        </Button>
      </form>

      <div className="space-y-1.5 text-center text-sm">
        <p className="text-muted-foreground">
          Didn&apos;t get the email?{' '}
          <button
            type="button"
            onClick={() => void resend()}
            disabled={cooldown > 0}
            className="font-medium text-primary underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Send another code'}
          </button>
        </p>
        <button
          type="button"
          onClick={onBack}
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Use a different login
        </button>
      </div>
    </div>
  );
}
