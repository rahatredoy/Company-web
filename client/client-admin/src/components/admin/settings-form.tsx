'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { PaymentMethodRow, StoreSettingsRow } from '@/lib/types';
import { api, ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toaster';
import { COMMON_CURRENCY_CODES, CURRENCIES, currencyByCode, type CurrencyOption } from '@/lib/currencies';
import { useT } from '@/lib/i18n';
import { LANGUAGES, resolveLanguage } from '@/lib/i18n/languages';
import { DICTIONARIES } from '@/lib/i18n/messages';
import { createTranslator } from '@/lib/i18n/translator';
import { SELECT_CLASS } from './category-tree';
import { PageHeader } from './page-header';
import { AnnouncementSection, StorefrontSection, designPayloadFrom, type DesignPayload } from './design-picker';
import { SETTINGS_CONTROL, SettingsSection } from './settings-section';

/**
 * The Settings screen: the store, its contact details, how the storefront looks
 * and how customers pay — one form and one Save.
 *
 * Save writes two resources, `PUT /settings` and then `PUT /website/design`,
 * because they are two tables under two permissions. Each is sent only when the
 * admin may write it, and each omits the keys this screen does not draw (the
 * SEO copy, the sizes and stock alert products carry for themselves, category
 * icons, the footer) — the API keeps what is stored for a key it is not sent, so
 * nothing this screen does not show can be reset by it. Payment methods are not
 * part of the save: each switch is its own write, as it always was.
 *
 * Currency is the field with teeth, and it is the store's currency everywhere:
 * the panel prints every figure in it, the storefront prices every shelf in it
 * and checkout charges in it. Prices are plain decimals with no currency of
 * their own, so changing the code **re-labels** every price rather than
 * converting it — 40 stays 40, in the new symbol. On a shop that has taken
 * orders the save stops and says so in a dialog before it goes through; the API
 * refuses it without that confirmation too.
 *
 * Language is the other field that reaches past this screen: it is what the
 * whole panel, the storefront and the API's messages are shown in. It is a
 * picker of the languages there is a dictionary for — a free-text code would
 * save "fr" and change nothing anyone could see — and a save that moves it is
 * confirmed by a toast in the language just chosen, since `router.refresh()`
 * redraws everything else in it a moment later.
 */

type SettingsPayload = Record<string, unknown> & { currency: string };

/** Everything one Save sends. A `null` half is one this admin may not write. */
interface PendingSave {
  settings: SettingsPayload | null;
  design: ReturnType<typeof designPayloadFrom> | null;
}

const currencyLabel = (option: CurrencyOption) =>
  `${option.code} — ${option.name}${option.symbol ? ` (${option.symbol})` : ''}`;

const COMMON_CURRENCIES = COMMON_CURRENCY_CODES.map((code) => currencyByCode(code)).filter(
  (option): option is CurrencyOption => Boolean(option),
);

export function SettingsForm({
  settings,
  paymentMethods,
  design,
  canUpdate,
  canManageDesign,
}: {
  settings: StoreSettingsRow;
  paymentMethods: PaymentMethodRow[];
  /** `null` when this admin may not read the design. */
  design: DesignPayload | null;
  canUpdate: boolean;
  canManageDesign: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  /*
   * Controlled, unlike the rest of the form, because the field describes its own
   * consequences as it changes: the price preview and the warning under it both
   * follow the selection before anything is saved.
   */
  const [currency, setCurrency] = React.useState(settings.currency);
  /** A save that is waiting on the owner to confirm a currency change. */
  const [pendingSave, setPendingSave] = React.useState<PendingSave | null>(null);

  const currencyChanged = currency !== settings.currency;
  const savedCurrencyListed = Boolean(currencyByCode(settings.currency));
  const ordersElsewhere = settings.orderCurrencies.filter((row) => row.currency !== settings.currency);

  const designWritable = design !== null && canManageDesign;
  const pendingCurrency = pendingSave?.settings?.currency ?? currency;

  const save = async (pending: PendingSave, confirmCurrencyChange = false) => {
    setSaving(true);
    setError('');
    setFieldErrors({});
    let wrote = false;

    try {
      if (pending.settings) {
        await api.put('/api/v1/admin/settings', { ...pending.settings, confirmCurrencyChange });
        wrote = true;
      }
      if (pending.design) {
        await api.put('/api/v1/admin/website/design', pending.design);
        wrote = true;
      }

      setPendingSave(null);
      // Said in the language just saved, which is what the panel is about to become.
      const language = resolveLanguage(String(pending.settings?.language ?? t.language));
      const next = language === t.language ? t : createTranslator(language, DICTIONARIES[language]);
      toast.success(
        pending.settings && pending.settings.currency !== settings.currency
          ? next('Settings saved. Your store now uses {currency}.', { currency: pending.settings.currency })
          : next('Settings saved.'),
      );
    } catch (caught) {
      /*
       * The first order can arrive while this page is open, so the page's
       * `orderCount` is not the last word. The API refuses in that case, and the
       * answer is the same dialog a known order count would have opened.
       */
      if (caught instanceof ApiError && caught.code === 'CURRENCY_CHANGE_UNCONFIRMED' && !confirmCurrencyChange) {
        setPendingSave(pending);
        return;
      }

      setPendingSave(null);
      if (caught instanceof ApiError && caught.details) {
        setFieldErrors(
          Object.fromEntries(Object.entries(caught.details).map(([key, messages]) => [key, messages[0] ?? ''])),
        );
      }
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
      // Re-reads the session too, which is what moves every other screen of the
      // panel onto a new currency. Also after a half-finished save: the store
      // settings may have landed even though the design did not.
      if (wrote) router.refresh();
    }
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? '').trim();
    const optional = (name: string) => text(name) || null;

    const pending: PendingSave = {
      settings: canUpdate
        ? {
            storeName: text('storeName'),
            currency,
            language: text('language'),
            timezone: text('timezone'),
            businessName: optional('businessName'),
            businessEmail: optional('businessEmail'),
            businessPhone: optional('businessPhone'),
            businessAddress: optional('businessAddress'),
            whatsappNumber: optional('whatsappNumber'),
            whatsappEnabled: data.get('whatsappEnabled') === 'on',
          }
        : null,
      design: designWritable && design ? designPayloadFrom(data, design) : null,
    };

    if (pending.settings && currencyChanged && settings.orderCount > 0) {
      setPendingSave(pending);
      return;
    }

    void save(pending);
  };

  const togglePayment = async (method: PaymentMethodRow) => {
    try {
      await api.put('/api/v1/admin/settings/payment-methods', {
        provider: method.provider,
        label: method.label,
        description: method.description,
        instructions: method.instructions,
        isEnabled: !method.isEnabled,
        sortOrder: method.sortOrder,
      });

      toast.success(
        method.isEnabled
          ? t('{method} switched off.', { method: method.label })
          : t('{method} switched on.', { method: method.label }),
      );
      router.refresh();
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  };

  const payments = (
    <SettingsSection title={t('Payment methods')}>
      {paymentMethods.length === 0 ? (
        <Alert variant="warning">{t('No payment method is set up, so nobody can check out.')}</Alert>
      ) : (
        <ul className="divide-y divide-border/60">
          {paymentMethods.map((method) => (
            <li key={method.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="text-sm font-medium">{method.label}</p>
                {method.description ? (
                  <p className="truncate text-xs text-muted-foreground">{method.description}</p>
                ) : null}
              </div>
              <Switch
                checked={method.isEnabled}
                disabled={!canUpdate}
                onCheckedChange={() => togglePayment(method)}
                aria-label={
                  method.isEnabled
                    ? t('Disable {method}', { method: method.label })
                    : t('Enable {method}', { method: method.label })
                }
              />
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <PageHeader
        title={t('Settings')}
        description={t('Your store at {slug}.', { slug: settings.slug })}
        actions={
          canUpdate || designWritable ? (
            <Button type="submit" loading={saving}>
              {t('Save settings')}
            </Button>
          ) : null
        }
      />

      {error ? <Alert variant="danger">{error}</Alert> : null}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <SettingsSection title={t('Store')}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('Store name')} htmlFor="storeName" required error={fieldErrors.storeName} className="space-y-1.5">
                <Input
                  id="storeName"
                  name="storeName"
                  defaultValue={settings.storeName}
                  disabled={!canUpdate}
                  className={SETTINGS_CONTROL}
                />
              </Field>

              <Field
                label={t('Currency')}
                htmlFor="currency"
                error={fieldErrors.currency}
                className="space-y-1.5"
                hint={
                  <>
                    {t('Prices show as')}{' '}
                    {/*
                      Formatted by this browser's Intl, which is not always the
                      server's build — the one text node here allowed to differ.
                    */}
                    <span className="font-medium text-foreground tabular-nums" suppressHydrationWarning>
                      {t.money('1299.50', currency)}
                    </span>
                  </>
                }
              >
                <select
                  id="currency"
                  name="currency"
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                  disabled={!canUpdate}
                  className={cn(SELECT_CLASS, SETTINGS_CONTROL)}
                >
                  {/*
                    A store provisioned with a code that has since left circulation
                    still sees what it has, rather than a select that silently
                    shows the first option and saves it.
                  */}
                  {savedCurrencyListed ? null : (
                    <option value={settings.currency}>{t('{currency} — current', { currency: settings.currency })}</option>
                  )}
                  <optgroup label={t('Most used')}>
                    {COMMON_CURRENCIES.map((option) => (
                      <option key={`common-${option.code}`} value={option.code}>
                        {currencyLabel(option)}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label={t('All currencies')}>
                    {CURRENCIES.map((option) => (
                      <option key={option.code} value={option.code}>
                        {currencyLabel(option)}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </Field>

              <Field
                label={t('Language')}
                htmlFor="language"
                error={fieldErrors.language}
                className="space-y-1.5"
                hint={t('The admin panel and your storefront are shown in this language.')}
              >
                <select
                  id="language"
                  name="language"
                  defaultValue={resolveLanguage(settings.language)}
                  disabled={!canUpdate}
                  className={cn(SELECT_CLASS, SETTINGS_CONTROL)}
                >
                  {LANGUAGES.map((language) => (
                    <option key={language.code} value={language.code}>
                      {/* Each in its own script, so an owner finds theirs whatever the panel is in. */}
                      {language.nativeName === language.name ? language.name : `${language.nativeName} — ${language.name}`}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('Timezone')} htmlFor="timezone" error={fieldErrors.timezone} className="space-y-1.5">
                <Input
                  id="timezone"
                  name="timezone"
                  defaultValue={settings.timezone}
                  disabled={!canUpdate}
                  className={SETTINGS_CONTROL}
                />
              </Field>
            </div>

            {currencyChanged && settings.orderCount > 0 ? (
              <Alert
                variant="warning"
                title={t('Switching from {from} to {to}', { from: settings.currency, to: currency })}
              >
                {t.plural(
                  settings.orderCount,
                  'Prices are not converted — each keeps its number and takes the new symbol. The {count} order already taken keeps its own currency. You will be asked to confirm.',
                  'Prices are not converted — each keeps its number and takes the new symbol. The {count} orders already taken keep their own currency. You will be asked to confirm.',
                )}
              </Alert>
            ) : null}

            {!currencyChanged && ordersElsewhere.length > 0 ? (
              <Alert variant="info">
                {t(
                  'Orders taken before a currency switch ({orders}) are left out of revenue totals, which add up {currency} orders only.',
                  {
                    orders: ordersElsewhere
                      .map((row) => t('{count} in {currency}', { count: row.orders, currency: row.currency }))
                      .join(', '),
                    currency: settings.currency,
                  },
                )}
              </Alert>
            ) : null}
          </SettingsSection>

          <SettingsSection
            title={t('Contact')}
            action={
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                {t('WhatsApp button')}
                <Switch name="whatsappEnabled" defaultChecked={settings.whatsappEnabled} disabled={!canUpdate} />
              </label>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('Business name')} htmlFor="businessName" error={fieldErrors.businessName} className="space-y-1.5">
                <Input
                  id="businessName"
                  name="businessName"
                  defaultValue={settings.businessName ?? ''}
                  disabled={!canUpdate}
                  className={SETTINGS_CONTROL}
                />
              </Field>
              <Field label={t('Email')} htmlFor="businessEmail" error={fieldErrors.businessEmail} className="space-y-1.5">
                <Input
                  id="businessEmail"
                  name="businessEmail"
                  type="email"
                  defaultValue={settings.businessEmail ?? ''}
                  disabled={!canUpdate}
                  className={SETTINGS_CONTROL}
                />
              </Field>
              <Field label={t('Phone')} htmlFor="businessPhone" error={fieldErrors.businessPhone} className="space-y-1.5">
                <Input
                  id="businessPhone"
                  name="businessPhone"
                  defaultValue={settings.businessPhone ?? ''}
                  disabled={!canUpdate}
                  className={SETTINGS_CONTROL}
                />
              </Field>
              <Field label={t('WhatsApp number')} htmlFor="whatsappNumber" error={fieldErrors.whatsappNumber} className="space-y-1.5">
                <Input
                  id="whatsappNumber"
                  name="whatsappNumber"
                  defaultValue={settings.whatsappNumber ?? ''}
                  disabled={!canUpdate}
                  className={SETTINGS_CONTROL}
                />
              </Field>
              <Field
                label={t('Address')}
                htmlFor="businessAddress"
                error={fieldErrors.businessAddress}
                className="space-y-1.5 sm:col-span-2"
              >
                <Textarea
                  id="businessAddress"
                  name="businessAddress"
                  rows={2}
                  defaultValue={settings.businessAddress ?? ''}
                  disabled={!canUpdate}
                  className="min-h-0"
                />
              </Field>
            </div>
          </SettingsSection>

          {design ? payments : null}
        </div>

        <div className="space-y-4">
          {design ? (
            <>
              <StorefrontSection design={design} disabled={!canManageDesign} />
              <AnnouncementSection design={design} disabled={!canManageDesign} />
            </>
          ) : (
            payments
          )}
        </div>
      </div>

      <Dialog
        open={pendingSave !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setPendingSave(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Switch your store to {currency}?', { currency: pendingCurrency })}</DialogTitle>
            <DialogDescription>
              {t('This store has taken orders in {currency}. Here is what the switch does and does not do.', {
                currency: settings.currency,
              })}
            </DialogDescription>
          </DialogHeader>

          <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              {t.rich(
                '{lead} Nothing is converted: {before} becomes {after}. Products and coupon amounts all change symbol the same way.',
                {
                  lead: <span className="text-foreground">{t('Every price keeps its number.')}</span>,
                  before: (
                    <span className="tabular-nums" suppressHydrationWarning>
                      {t.money('1299.50', settings.currency)}
                    </span>
                  ),
                  after: (
                    <span className="tabular-nums" suppressHydrationWarning>
                      {t.money('1299.50', pendingCurrency)}
                    </span>
                  ),
                },
              )}
            </li>
            <li>
              {t.rich('{lead} show {currency} straight away, and new orders are charged in it.', {
                lead: <span className="text-foreground">{t('The admin panel and your storefront')}</span>,
                currency: pendingCurrency,
              })}
            </li>
            <li>
              {t.rich(
                '{lead} They stay in the currency they were charged in, and revenue totals count {currency} orders only.',
                {
                  lead: <span className="text-foreground">{t('Orders already taken are not touched.')}</span>,
                  currency: pendingCurrency,
                },
              )}
            </li>
          </ul>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingSave(null)} disabled={saving}>
              {t('Keep {currency}', { currency: settings.currency })}
            </Button>
            <Button
              type="button"
              loading={saving}
              onClick={() => {
                if (pendingSave) void save(pendingSave, true);
              }}
            >
              {t('Switch to {currency}', { currency: pendingCurrency })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
