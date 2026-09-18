'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Landmark, Loader2, Wand2 } from 'lucide-react';
import type {
  CardType,
  CombinableClass,
  CustomerGroup,
  CustomerSegment,
  DiscountKind,
  DiscountReference,
  DiscountStatus,
  DiscountValueType,
  DiscountView,
  IssueEvent,
  PaymentCondition,
} from '@/lib/types';
import { api, ApiError, errorMessage } from '@/lib/api';
import {
  CARD_TYPE_LABELS,
  COMBINABLE_LABELS,
  DAY_ORDER,
  DAY_SHORT,
  GROUP_LABELS,
  ISSUE_EVENT_META,
  KIND_META,
  KIND_ORDER,
  PAYMENT_LABELS,
  PAYMENT_ORDER,
  SEGMENT_META,
  VALUE_TYPE_META,
  codeRequired,
  codeless,
  draftFromView,
  emptyDraft,
  payloadFromDraft,
  previewRows,
  recordFromDraft,
  type DiscountDraft,
  type DiscountRules,
} from '@/lib/discounts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { EntityPicker, type LookupOption, type LookupType } from './entity-picker';

const SELECT_CLASS = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';

type Step = 'offer' | 'products' | 'customers' | 'payment' | 'limits' | 'review';

const STEPS: { key: Step; label: string }[] = [
  { key: 'offer', label: 'Offer' },
  { key: 'products', label: 'Products' },
  { key: 'customers', label: 'Customers' },
  { key: 'payment', label: 'Payment & area' },
  { key: 'limits', label: 'Limits & schedule' },
  { key: 'review', label: 'Review' },
];

/** Which step an API field error belongs to, so the tab can say it needs attention. */
function stepOf(field: string): Step {
  const head = field.split('.')[0]!;
  if (['productRules', 'purchaseRules', 'minOrderAmount', 'minQuantity'].includes(head)) return 'products';
  if (['customerRules', 'customerIds', 'issueRules'].includes(head)) return 'customers';
  if (['paymentRules', 'areaRules'].includes(head)) return 'payment';
  if (
    [
      'usageLimit',
      'perCustomerLimit',
      'cooldownAmount',
      'cooldownUnit',
      'startsAt',
      'endsAt',
      'timezone',
      'scheduleRules',
      'combinationRules',
      'priority',
      'maxDiscountedQuantity',
      'minSubtotalAfterDiscount',
    ].includes(head)
  ) {
    return 'limits';
  }
  return 'offer';
}

const listText = (values: string[]) => values.join(', ');
const splitList = (value: string) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

/**
 * Writing a discount: one draft, six steps, and a Review step that reads the
 * rule back in the sentences the list and the detail panel use.
 *
 * Every rule group is sent on every save (`payloadFromDraft`), so an edit can
 * never leave half an old rule behind. The API is what decides — the steps only
 * collect, and its per-field errors are put back beside the field that caused
 * them, with the step holding it marked.
 */
export function DiscountEditor({
  open,
  onOpenChange,
  discountId,
  reference,
  onOpenBanks,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null writes a new one. */
  discountId: string | null;
  reference: DiscountReference;
  onOpenBanks: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = React.useState<DiscountDraft>(() => emptyDraft());
  const [labels, setLabels] = React.useState<Record<string, string>>({});
  const [step, setStep] = React.useState<Step>('offer');
  // The manager remounts this per opening (a fresh `key`), so the state above is
  // already the empty form and only a stored discount has anything to fetch.
  const [loading, setLoading] = React.useState(Boolean(discountId));
  const [loadError, setLoadError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [generating, setGenerating] = React.useState(false);
  const [editingName, setEditingName] = React.useState('');

  React.useEffect(() => {
    if (!discountId) return;
    let cancelled = false;
    api
      .get<DiscountView>(`/api/v1/admin/discounts/${discountId}`)
      .then((view) => {
        if (cancelled) return;
        setDraft(draftFromView(view));
        setLabels(Object.fromEntries(Object.entries(view.labels).map(([id, entry]) => [id, entry.label])));
        setEditingName(view.name);
      })
      .catch((caught) => {
        if (!cancelled) setLoadError(errorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [discountId]);

  const onLabels = React.useCallback((options: LookupOption[]) => {
    setLabels((current) => {
      const next = { ...current };
      for (const option of options) next[option.id] = option.label;
      return next;
    });
  }, []);

  const set = <K extends keyof DiscountDraft>(key: K, value: DiscountDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const setRule = <G extends keyof DiscountRules, K extends keyof DiscountRules[G]>(
    group: G,
    key: K,
    value: DiscountRules[G][K],
  ) =>
    setDraft((current) => ({
      ...current,
      rules: { ...current.rules, [group]: { ...current.rules[group], [key]: value } },
    }));

  const changeKind = (kind: DiscountKind) =>
    setDraft((current) => {
      const next = { ...current, kind };
      if (kind === 'payment_offer' && current.rules.payment.channels.length === 0) {
        next.rules = { ...current.rules, payment: { ...current.rules.payment, channels: ['bkash'] } };
      }
      if (kind === 'voucher' && current.repeat === 'unlimited') next.repeat = 'once';
      return next;
    });

  const err = (field: string) => fieldErrors[field];
  const stepsWithErrors = new Set(Object.keys(fieldErrors).map(stepOf));

  const picker = (field: string, type: LookupType, value: string[], onChange: (next: string[]) => void, placeholder: string) => (
    <EntityPicker
      id={field}
      type={type}
      value={value}
      onChange={onChange}
      labels={labels}
      onLabels={onLabels}
      placeholder={placeholder}
      invalid={Boolean(err(field))}
    />
  );

  const generateCode = async () => {
    setGenerating(true);
    try {
      const result = await api.post<{ code: string }>('/api/v1/admin/discounts/generate-code', {});
      set('code', result.code);
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setGenerating(false);
    }
  };

  const save = async (status?: DiscountStatus) => {
    if (saving) return;
    setSaving(true);
    setError('');
    setFieldErrors({});

    try {
      const body = payloadFromDraft(draft, status ?? draft.status);
      if (discountId) await api.put(`/api/v1/admin/discounts/${discountId}`, body);
      else await api.post('/api/v1/admin/discounts', body);

      toast.success(status === 'draft' ? 'Saved as a draft.' : 'Discount saved.');
      onOpenChange(false);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.details) {
        const mapped = Object.fromEntries(
          Object.entries(caught.details).map(([key, messages]) => [key, messages[0] ?? '']),
        );
        setFieldErrors(mapped);
        const first = Object.keys(mapped)[0];
        if (first) setStep(stepOf(first));
      }
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const { rules } = draft;
  const isBundle = draft.valueType === 'bundle';
  const isBxgy = draft.valueType === 'buy_x_get_y';
  const hasValue = !isBxgy;
  const isVoucher = draft.kind === 'voucher';
  const money = `(${reference.currency})`;

  const review = previewRows(recordFromDraft(draft), {
    currency: reference.currency,
    // `recordFromDraft` writes wall-clock times as UTC instants; read them back in UTC.
    timeZone: 'UTC',
    names: (id) => labels[id],
    strategy: reference.strategy,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{discountId ? `Edit ${editingName || 'discount'}` : 'New discount'}</DialogTitle>
          <DialogDescription>
            Set what it takes off, then the conditions. Your store checks every one at checkout.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {loadError ? (
            <Alert variant="danger">{loadError}</Alert>
          ) : loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" aria-hidden />
            </div>
          ) : (
            <Tabs value={step} onValueChange={(value) => setStep(value as Step)} className="space-y-5">
              {error ? <Alert variant="danger">{error}</Alert> : null}

              <TabsList className="w-full justify-start">
                {STEPS.map((entry) => (
                  <TabsTrigger key={entry.key} value={entry.key}>
                    {entry.label}
                    {stepsWithErrors.has(entry.key) ? (
                      <span className="size-1.5 rounded-full bg-destructive" aria-label="needs attention" />
                    ) : null}
                  </TabsTrigger>
                ))}
              </TabsList>

              {/* ------------------------------------------------------ offer -- */}
              <TabsContent value="offer" className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Type" htmlFor="kind" hint={KIND_META[draft.kind].description}>
                    <select
                      id="kind"
                      className={SELECT_CLASS}
                      value={draft.kind}
                      onChange={(event) => changeKind(event.target.value as DiscountKind)}
                    >
                      {KIND_ORDER.map((kind) => (
                        <option key={kind} value={kind}>
                          {KIND_META[kind].label}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Name" htmlFor="name" required error={err('name')} hint="For you. Customers do not see it.">
                    <Input
                      id="name"
                      value={draft.name}
                      maxLength={140}
                      invalid={Boolean(err('name'))}
                      onChange={(event) => set('name', event.target.value)}
                    />
                  </Field>

                  {codeless(draft.kind) ? null : (
                    <Field
                      label="Code"
                      htmlFor="code"
                      required={codeRequired(draft.kind)}
                      error={err('code')}
                      hint={
                        codeRequired(draft.kind)
                          ? 'Letters, numbers and dashes.'
                          : isVoucher
                            ? 'Left empty, one is made for you.'
                            : 'Optional. Without one the offer applies on its own.'
                      }
                    >
                      <div className="flex gap-2">
                        <Input
                          id="code"
                          value={draft.code}
                          maxLength={40}
                          className="font-mono uppercase"
                          invalid={Boolean(err('code'))}
                          onChange={(event) => set('code', event.target.value.toUpperCase())}
                        />
                        <Button type="button" variant="outline" onClick={() => void generateCode()} loading={generating}>
                          <Wand2 aria-hidden /> Generate
                        </Button>
                      </div>
                    </Field>
                  )}

                  <Field label="Status" htmlFor="status" hint="A paused or draft discount is never applied.">
                    <select
                      id="status"
                      className={SELECT_CLASS}
                      value={draft.status}
                      onChange={(event) => set('status', event.target.value as DiscountStatus)}
                    >
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                      <option value="draft">Draft</option>
                    </select>
                  </Field>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Discount" htmlFor="valueType" hint={VALUE_TYPE_META[draft.valueType].description}>
                    <select
                      id="valueType"
                      className={SELECT_CLASS}
                      value={draft.valueType}
                      onChange={(event) => set('valueType', event.target.value as DiscountValueType)}
                    >
                      {(Object.keys(VALUE_TYPE_META) as DiscountValueType[]).map((type) => (
                        <option key={type} value={type}>
                          {VALUE_TYPE_META[type].label}
                        </option>
                      ))}
                    </select>
                  </Field>

                  {hasValue ? (
                    <Field
                      label={
                        draft.valueType === 'percentage'
                          ? 'Percentage (%)'
                          : draft.valueType === 'fixed_price'
                            ? `Price each ${money}`
                            : isBundle
                              ? `Bundle price ${money}`
                              : `Amount off ${money}`
                      }
                      htmlFor="value"
                      required
                      error={err('value')}
                    >
                      <Input
                        id="value"
                        inputMode="decimal"
                        value={draft.value}
                        invalid={Boolean(err('value'))}
                        onChange={(event) => set('value', event.target.value)}
                      />
                    </Field>
                  ) : null}

                  {draft.valueType === 'percentage' ? (
                    <Field
                      label={`Maximum discount ${money}`}
                      htmlFor="maxDiscountAmount"
                      error={err('maxDiscountAmount')}
                      hint="Empty means no ceiling."
                    >
                      <Input
                        id="maxDiscountAmount"
                        inputMode="decimal"
                        value={draft.maxDiscountAmount}
                        onChange={(event) => set('maxDiscountAmount', event.target.value)}
                      />
                    </Field>
                  ) : null}
                </div>

                {isBxgy ? (
                  <div className="space-y-4 rounded-lg border border-border p-4">
                    <div className="grid gap-4 md:grid-cols-3">
                      <Field label="Customer buys" htmlFor="buyQuantity" error={err('rewardRules.buyQuantity')}>
                        <Input
                          id="buyQuantity"
                          type="number"
                          min={1}
                          value={rules.reward.buyQuantity}
                          onChange={(event) => setRule('reward', 'buyQuantity', Number(event.target.value) || 1)}
                        />
                      </Field>
                      <Field label="Customer gets" htmlFor="getQuantity" error={err('rewardRules.getQuantity')}>
                        <Input
                          id="getQuantity"
                          type="number"
                          min={1}
                          value={rules.reward.getQuantity}
                          onChange={(event) => setRule('reward', 'getQuantity', Number(event.target.value) || 1)}
                        />
                      </Field>
                      <Field label="Off what they get (%)" htmlFor="getDiscountPercent" hint="100 is free.">
                        <Input
                          id="getDiscountPercent"
                          type="number"
                          min={1}
                          max={100}
                          value={rules.reward.getDiscountPercent}
                          onChange={(event) => setRule('reward', 'getDiscountPercent', Number(event.target.value) || 100)}
                        />
                      </Field>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Buy from these products" htmlFor="rewardRules.buyProductIds" hint="Empty means any eligible product.">
                        {picker('rewardRules.buyProductIds', 'products', rules.reward.buyProductIds, (next) => setRule('reward', 'buyProductIds', next), 'Search products')}
                      </Field>
                      <Field label="…or these categories" htmlFor="rewardRules.buyCategoryIds">
                        {picker('rewardRules.buyCategoryIds', 'categories', rules.reward.buyCategoryIds, (next) => setRule('reward', 'buyCategoryIds', next), 'Search categories')}
                      </Field>
                      <Field label="Get these products" htmlFor="rewardRules.getProductIds" hint="Empty means the same as what they buy.">
                        {picker('rewardRules.getProductIds', 'products', rules.reward.getProductIds, (next) => setRule('reward', 'getProductIds', next), 'Search products')}
                      </Field>
                      <Field label="…or these categories" htmlFor="rewardRules.getCategoryIds">
                        {picker('rewardRules.getCategoryIds', 'categories', rules.reward.getCategoryIds, (next) => setRule('reward', 'getCategoryIds', next), 'Search categories')}
                      </Field>
                    </div>
                    <Field label="Times per order" htmlFor="maxApplications" hint="Empty repeats as often as the basket allows.">
                      <Input
                        id="maxApplications"
                        type="number"
                        min={1}
                        className="max-w-40"
                        value={rules.reward.maxApplications ?? ''}
                        onChange={(event) =>
                          setRule('reward', 'maxApplications', event.target.value ? Number(event.target.value) : null)
                        }
                      />
                    </Field>
                  </div>
                ) : null}

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Title shown to customers" htmlFor="title" hint="Optional — in the basket and on receipts.">
                    <Input id="title" value={draft.title} maxLength={200} onChange={(event) => set('title', event.target.value)} />
                  </Field>
                  <Field label="Short description" htmlFor="summary">
                    <Input id="summary" value={draft.summary} maxLength={400} onChange={(event) => set('summary', event.target.value)} />
                  </Field>
                </div>
                <Field label="Private note" htmlFor="notes">
                  <Textarea id="notes" rows={2} value={draft.notes} maxLength={1000} onChange={(event) => set('notes', event.target.value)} />
                </Field>
              </TabsContent>

              {/* --------------------------------------------------- products -- */}
              <TabsContent value="products" className="space-y-5">
                {isBundle ? (
                  <Field
                    label="Products in the bundle"
                    htmlFor="productRules.productIds"
                    required
                    error={err('productRules.productIds')}
                    hint="Pick at least two. Bought together, they cost the bundle price."
                  >
                    {picker('productRules.productIds', 'products', rules.product.productIds, (next) => setRule('product', 'productIds', next), 'Search products')}
                  </Field>
                ) : (
                  <>
                    <Field label="Applies to" htmlFor="appliesTo" error={err('productRules.appliesTo')}>
                      <select
                        id="appliesTo"
                        className={SELECT_CLASS}
                        value={rules.product.appliesTo}
                        onChange={(event) => setRule('product', 'appliesTo', event.target.value as 'all' | 'specific')}
                      >
                        <option value="all">Entire store</option>
                        <option value="specific">Specific categories, brands or products</option>
                      </select>
                    </Field>

                    {rules.product.appliesTo === 'specific' ? (
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Categories" htmlFor="productRules.categoryIds" error={err('productRules.categoryIds')}>
                          {picker('productRules.categoryIds', 'categories', rules.product.categoryIds, (next) => setRule('product', 'categoryIds', next), 'Search categories')}
                        </Field>
                        <Field label="Brands" htmlFor="productRules.brandIds" error={err('productRules.brandIds')}>
                          {picker('productRules.brandIds', 'brands', rules.product.brandIds, (next) => setRule('product', 'brandIds', next), 'Search brands')}
                        </Field>
                        <Field label="Products" htmlFor="productRules.productIds" error={err('productRules.productIds')}>
                          {picker('productRules.productIds', 'products', rules.product.productIds, (next) => setRule('product', 'productIds', next), 'Search products')}
                        </Field>
                        <Field label="Variants" htmlFor="productRules.variantIds" error={err('productRules.variantIds')}>
                          {picker('productRules.variantIds', 'variants', rules.product.variantIds, (next) => setRule('product', 'variantIds', next), 'Search by name or SKU')}
                        </Field>
                        {reference.collections.length > 0 ? (
                          <Field label="Collections" htmlFor="productRules.collectionIds" error={err('productRules.collectionIds')}>
                            {picker('productRules.collectionIds', 'collections', rules.product.collectionIds, (next) => setRule('product', 'collectionIds', next), 'Search collections')}
                          </Field>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                )}

                <fieldset className="space-y-4 rounded-lg border border-border p-4">
                  <legend className="px-1 text-sm font-medium">Never discount</legend>
                  <div className="grid gap-4 md:grid-cols-3">
                    <Field label="Categories" htmlFor="productRules.excludeCategoryIds">
                      {picker('productRules.excludeCategoryIds', 'categories', rules.product.excludeCategoryIds, (next) => setRule('product', 'excludeCategoryIds', next), 'Search categories')}
                    </Field>
                    <Field label="Brands" htmlFor="productRules.excludeBrandIds">
                      {picker('productRules.excludeBrandIds', 'brands', rules.product.excludeBrandIds, (next) => setRule('product', 'excludeBrandIds', next), 'Search brands')}
                    </Field>
                    <Field label="Products" htmlFor="productRules.excludeProductIds">
                      {picker('productRules.excludeProductIds', 'products', rules.product.excludeProductIds, (next) => setRule('product', 'excludeProductIds', next), 'Search products')}
                    </Field>
                  </div>
                  <ToggleRow
                    checked={rules.product.excludeSaleItems}
                    onChange={(value) => setRule('product', 'excludeSaleItems', value)}
                    label="Items already on sale"
                  />
                  <ToggleRow
                    checked={rules.product.excludeDiscountedItems}
                    onChange={(value) => setRule('product', 'excludeDiscountedItems', value)}
                    label="Items another discount on the order has already reduced"
                  />
                </fieldset>

                <fieldset className="space-y-4 rounded-lg border border-border p-4">
                  <legend className="px-1 text-sm font-medium">The basket must have</legend>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label={`Minimum order ${money}`} htmlFor="minOrderAmount" error={err('minOrderAmount')}>
                      <Input id="minOrderAmount" inputMode="decimal" value={draft.minOrderAmount} onChange={(event) => set('minOrderAmount', event.target.value)} />
                    </Field>
                    <Field label="Minimum number of items" htmlFor="minQuantity" error={err('minQuantity')}>
                      <Input id="minQuantity" type="number" min={1} value={draft.minQuantity} onChange={(event) => set('minQuantity', event.target.value)} />
                    </Field>
                    <Field label="One of these products" htmlFor="purchaseRules.requiredProductIds">
                      {picker('purchaseRules.requiredProductIds', 'products', rules.purchase.requiredProductIds, (next) => setRule('purchase', 'requiredProductIds', next), 'Search products')}
                    </Field>
                    <Field label="…or something from these categories" htmlFor="purchaseRules.requiredCategoryIds">
                      {picker('purchaseRules.requiredCategoryIds', 'categories', rules.purchase.requiredCategoryIds, (next) => setRule('purchase', 'requiredCategoryIds', next), 'Search categories')}
                    </Field>
                    <Field label="…or these brands" htmlFor="purchaseRules.requiredBrandIds">
                      {picker('purchaseRules.requiredBrandIds', 'brands', rules.purchase.requiredBrandIds, (next) => setRule('purchase', 'requiredBrandIds', next), 'Search brands')}
                    </Field>
                  </div>
                </fieldset>
              </TabsContent>

              {/* -------------------------------------------------- customers -- */}
              <TabsContent value="customers" className="space-y-5">
                {isVoucher ? (
                  <>
                    <Field
                      label="Holders"
                      htmlFor="customerIds"
                      error={err('customerIds')}
                      hint="Customers who hold this voucher. Each can use it on their own account."
                    >
                      {reference.canSearchCustomers ? (
                        picker('customerIds', 'customers', draft.customerIds, (next) => set('customerIds', next), 'Search by name, email or phone')
                      ) : (
                        <p className="text-sm text-muted-foreground">Naming customers needs permission to view customers.</p>
                      )}
                    </Field>

                    <div className="space-y-4 rounded-lg border border-border p-4">
                      <ToggleRow
                        checked={draft.issueEnabled}
                        onChange={(value) => set('issueEnabled', value)}
                        label="Also hand it out automatically"
                      />
                      {draft.issueEnabled ? (
                        <div className="grid gap-4 md:grid-cols-3">
                          <Field label="When" htmlFor="issueEvent" error={err('issueRules')}>
                            <select
                              id="issueEvent"
                              className={SELECT_CLASS}
                              value={draft.issue.event}
                              onChange={(event) => set('issue', { ...draft.issue, event: event.target.value as IssueEvent })}
                            >
                              {(Object.keys(ISSUE_EVENT_META) as IssueEvent[]).map((event) => (
                                <option key={event} value={event}>
                                  {ISSUE_EVENT_META[event].label}
                                </option>
                              ))}
                            </select>
                          </Field>
                          {ISSUE_EVENT_META[draft.issue.event].threshold ? (
                            <Field label={ISSUE_EVENT_META[draft.issue.event].threshold} htmlFor="issueThreshold" required error={err('issueRules.threshold')}>
                              <Input
                                id="issueThreshold"
                                inputMode="decimal"
                                value={draft.issue.threshold}
                                onChange={(event) => set('issue', { ...draft.issue, threshold: event.target.value })}
                              />
                            </Field>
                          ) : null}
                          <Field label="Valid for (days)" htmlFor="issueValidDays" hint="Empty lasts as long as the voucher." error={err('issueRules.validDays')}>
                            <Input
                              id="issueValidDays"
                              type="number"
                              min={1}
                              value={draft.issue.validDays}
                              onChange={(event) => set('issue', { ...draft.issue, validDays: event.target.value })}
                            />
                          </Field>
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <>
                    <Field label="Who can use it" htmlFor="segment" hint={SEGMENT_META[rules.customer.segment].description}>
                      <select
                        id="segment"
                        className={SELECT_CLASS}
                        value={rules.customer.segment}
                        onChange={(event) => setRule('customer', 'segment', event.target.value as CustomerSegment)}
                      >
                        {(Object.keys(SEGMENT_META) as CustomerSegment[]).map((segment) => (
                          <option key={segment} value={segment}>
                            {SEGMENT_META[segment].label}
                          </option>
                        ))}
                      </select>
                    </Field>

                    {rules.customer.segment === 'groups' ? (
                      <Field label="Groups" htmlFor="customerRules.groups" error={err('customerRules.groups')}>
                        <CheckList<CustomerGroup>
                          options={reference.customerGroups.map((group) => ({ value: group, label: GROUP_LABELS[group] }))}
                          value={rules.customer.groups}
                          onChange={(next) => setRule('customer', 'groups', next)}
                        />
                      </Field>
                    ) : null}

                    {rules.customer.segment === 'selected' ? (
                      <Field label="Customers" htmlFor="customerIds" required error={err('customerIds')}>
                        {reference.canSearchCustomers ? (
                          picker('customerIds', 'customers', draft.customerIds, (next) => set('customerIds', next), 'Search by name, email or phone')
                        ) : (
                          <p className="text-sm text-muted-foreground">Naming customers needs permission to view customers.</p>
                        )}
                      </Field>
                    ) : null}

                    <fieldset className="space-y-4 rounded-lg border border-border p-4">
                      <legend className="px-1 text-sm font-medium">Narrow it further (optional)</legend>
                      <div className="grid gap-4 md:grid-cols-2">
                        <NumberField
                          id="minPreviousOrders"
                          label="At least this many previous orders"
                          value={rules.customer.minPreviousOrders}
                          error={err('customerRules.minPreviousOrders')}
                          onChange={(value) => setRule('customer', 'minPreviousOrders', value)}
                        />
                        <NumberField
                          id="registeredWithinDays"
                          label="Joined in the last (days)"
                          value={rules.customer.registeredWithinDays}
                          error={err('customerRules.registeredWithinDays')}
                          onChange={(value) => setRule('customer', 'registeredWithinDays', value)}
                        />
                        <NumberField
                          id="inactiveDays"
                          label="Has not ordered for (days)"
                          value={rules.customer.inactiveDays}
                          error={err('customerRules.inactiveDays')}
                          onChange={(value) => setRule('customer', 'inactiveDays', value)}
                        />
                        <NumberField
                          id="birthdayWindowDays"
                          label="Days either side of their birthday"
                          hint={`0 is the day itself. ${reference.customersWithBirthday} customers have a birthday on file.`}
                          min={0}
                          value={rules.customer.birthdayWindowDays}
                          error={err('customerRules.birthdayWindowDays')}
                          onChange={(value) => setRule('customer', 'birthdayWindowDays', value)}
                        />
                      </div>
                    </fieldset>
                  </>
                )}

                <ToggleRow
                  checked={rules.customer.limitByIdentity}
                  onChange={(value) => setRule('customer', 'limitByIdentity', value)}
                  label="Count accounts sharing an email or phone number as one customer"
                />
              </TabsContent>

              {/* ---------------------------------------------------- payment -- */}
              <TabsContent value="payment" className="space-y-5">
                <Field
                  label="Paid with"
                  htmlFor="paymentRules.channels"
                  error={err('paymentRules.channels')}
                  hint="Nothing ticked means any payment method."
                >
                  <CheckList<PaymentCondition>
                    options={PAYMENT_ORDER.map((channel) => ({ value: channel, label: PAYMENT_LABELS[channel] }))}
                    value={rules.payment.channels}
                    onChange={(next) => setRule('payment', 'channels', next)}
                  />
                </Field>

                <div className="space-y-4 rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">Cards from these banks</p>
                    <Button type="button" size="sm" variant="outline" onClick={onOpenBanks}>
                      <Landmark aria-hidden /> Manage banks
                    </Button>
                  </div>
                  <Field
                    htmlFor="paymentRules.bankIds"
                    error={err('paymentRules.bankIds')}
                    hint="A bank is recognised by the card prefixes listed under Manage banks."
                  >
                    {picker('paymentRules.bankIds', 'banks', rules.payment.bankIds, (next) => setRule('payment', 'bankIds', next), 'Search banks')}
                  </Field>
                  <Field label="Card types" htmlFor="paymentRules.cardTypes" hint="Nothing ticked means any.">
                    <CheckList<CardType>
                      options={(Object.keys(CARD_TYPE_LABELS) as CardType[]).map((type) => ({ value: type, label: CARD_TYPE_LABELS[type] }))}
                      value={rules.payment.cardTypes}
                      onChange={(next) => setRule('payment', 'cardTypes', next)}
                    />
                  </Field>
                  <Field
                    label="Only cards starting with"
                    htmlFor="cardPrefixes"
                    error={err('paymentRules.cardPrefixes')}
                    hint="Optional. The first 6 to 8 digits, separated by commas."
                  >
                    <ListInput
                      id="cardPrefixes"
                      value={rules.payment.cardPrefixes}
                      onChange={(next) => setRule('payment', 'cardPrefixes', next)}
                    />
                  </Field>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Delivered to cities" htmlFor="cities" error={err('areaRules.cities')} hint="Separated by commas. Empty means everywhere.">
                    <ListInput id="cities" value={rules.area.cities} onChange={(next) => setRule('area', 'cities', next)} />
                  </Field>
                  <Field label="Delivered to countries" htmlFor="countries" error={err('areaRules.countries')}>
                    <ListInput id="countries" value={rules.area.countries} onChange={(next) => setRule('area', 'countries', next)} />
                  </Field>
                </div>
              </TabsContent>

              {/* ----------------------------------------------------- limits -- */}
              <TabsContent value="limits" className="space-y-5">
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label="Total uses" htmlFor="usageLimit" error={err('usageLimit')} hint="Empty means unlimited.">
                    <Input id="usageLimit" type="number" min={1} value={draft.usageLimit} onChange={(event) => set('usageLimit', event.target.value)} />
                  </Field>
                  <Field label="Each customer can use it" htmlFor="repeat" error={err('perCustomerLimit')}>
                    <select
                      id="repeat"
                      className={SELECT_CLASS}
                      value={draft.repeat}
                      onChange={(event) => set('repeat', event.target.value as DiscountDraft['repeat'])}
                    >
                      <option value="unlimited">As often as they like</option>
                      <option value="once">Once</option>
                      <option value="daily">Once per day</option>
                      <option value="interval">Once every…</option>
                    </select>
                  </Field>
                  {draft.repeat === 'once' ? null : (
                    <Field label="At most, per customer" htmlFor="lifetimeLimit" hint="Empty means no lifetime cap.">
                      <Input id="lifetimeLimit" type="number" min={1} value={draft.lifetimeLimit} onChange={(event) => set('lifetimeLimit', event.target.value)} />
                    </Field>
                  )}
                </div>

                {draft.repeat === 'interval' ? (
                  <div className="grid gap-4 md:grid-cols-3">
                    <Field label="Every" htmlFor="cooldownAmount" error={err('cooldownAmount')}>
                      <Input id="cooldownAmount" type="number" min={1} value={draft.cooldownAmount} onChange={(event) => set('cooldownAmount', event.target.value)} />
                    </Field>
                    <Field label="Unit" htmlFor="cooldownUnit">
                      <select
                        id="cooldownUnit"
                        className={SELECT_CLASS}
                        value={draft.cooldownUnit}
                        onChange={(event) => set('cooldownUnit', event.target.value as DiscountDraft['cooldownUnit'])}
                      >
                        <option value="day">Days</option>
                        <option value="week">Weeks</option>
                        <option value="month">Months</option>
                      </select>
                    </Field>
                  </div>
                ) : null}

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Discount at most this many items" htmlFor="maxDiscountedQuantity" error={err('maxDiscountedQuantity')}>
                    <Input id="maxDiscountedQuantity" type="number" min={1} value={draft.maxDiscountedQuantity} onChange={(event) => set('maxDiscountedQuantity', event.target.value)} />
                  </Field>
                  <Field label={`Order must stay above ${money}`} htmlFor="minSubtotalAfterDiscount" error={err('minSubtotalAfterDiscount')} hint="After every discount is taken off.">
                    <Input id="minSubtotalAfterDiscount" inputMode="decimal" value={draft.minSubtotalAfterDiscount} onChange={(event) => set('minSubtotalAfterDiscount', event.target.value)} />
                  </Field>
                </div>

                <fieldset className="space-y-4 rounded-lg border border-border p-4">
                  <legend className="px-1 text-sm font-medium">When</legend>
                  <div className="grid gap-4 md:grid-cols-3">
                    <Field label="Starts" htmlFor="startsAt" error={err('startsAt')} hint="Empty starts now.">
                      <Input id="startsAt" type="datetime-local" value={draft.startsAt} onChange={(event) => set('startsAt', event.target.value)} />
                    </Field>
                    <Field label="Ends" htmlFor="endsAt" error={err('endsAt')}>
                      <Input
                        id="endsAt"
                        type="datetime-local"
                        value={draft.endsAt}
                        disabled={draft.noExpiry}
                        onChange={(event) => set('endsAt', event.target.value)}
                      />
                    </Field>
                    <Field label="Timezone" htmlFor="timezone" error={err('timezone')} hint={`Empty follows the store: ${reference.timezone}.`}>
                      <Input id="timezone" value={draft.timezone} placeholder={reference.timezone} onChange={(event) => set('timezone', event.target.value)} />
                    </Field>
                  </div>
                  <ToggleRow checked={draft.noExpiry} onChange={(value) => set('noExpiry', value)} label="No end date" />

                  <Field label="Only on these days" htmlFor="days" hint="Nothing picked means every day.">
                    <div className="flex flex-wrap gap-1.5">
                      {DAY_ORDER.map((day) => {
                        const on = rules.schedule.days.includes(day);
                        return (
                          <button
                            key={day}
                            type="button"
                            aria-pressed={on}
                            onClick={() =>
                              setRule('schedule', 'days', on ? rules.schedule.days.filter((entry) => entry !== day) : [...rules.schedule.days, day])
                            }
                            className={cn(
                              'rounded-md border px-3 py-1.5 text-sm transition-colors',
                              on ? 'border-primary bg-primary-soft' : 'border-border hover:border-border-strong',
                            )}
                          >
                            {DAY_SHORT[day]}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="From time" htmlFor="startTime" error={err('scheduleRules.startTime')}>
                      <Input
                        id="startTime"
                        type="time"
                        value={rules.schedule.startTime ?? ''}
                        onChange={(event) => setRule('schedule', 'startTime', event.target.value || null)}
                      />
                    </Field>
                    <Field label="Until time" htmlFor="endTime" error={err('scheduleRules.endTime')} hint="An end before the start runs past midnight.">
                      <Input
                        id="endTime"
                        type="time"
                        value={rules.schedule.endTime ?? ''}
                        onChange={(event) => setRule('schedule', 'endTime', event.target.value || null)}
                      />
                    </Field>
                  </div>
                </fieldset>

                <fieldset className="space-y-4 rounded-lg border border-border p-4">
                  <legend className="px-1 text-sm font-medium">With other offers</legend>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Combines" htmlFor="combinationMode">
                      <select
                        id="combinationMode"
                        className={SELECT_CLASS}
                        value={rules.combination.mode}
                        onChange={(event) => setRule('combination', 'mode', event.target.value as 'none' | 'selected' | 'all')}
                      >
                        <option value="none">With nothing else</option>
                        <option value="selected">With the kinds I pick</option>
                        <option value="all">With every other offer</option>
                      </select>
                    </Field>
                    <Field label="Priority" htmlFor="priority" error={err('priority')} hint="Lower goes first.">
                      <Input id="priority" type="number" min={1} max={1000} value={draft.priority} onChange={(event) => set('priority', event.target.value)} />
                    </Field>
                  </div>
                  {rules.combination.mode === 'selected' ? (
                    <Field htmlFor="combinationRules.with" error={err('combinationRules.with')}>
                      <CheckList<CombinableClass>
                        options={(Object.keys(COMBINABLE_LABELS) as CombinableClass[]).map((entry) => ({ value: entry, label: COMBINABLE_LABELS[entry] }))}
                        value={rules.combination.with}
                        onChange={(next) => setRule('combination', 'with', next)}
                      />
                    </Field>
                  ) : null}
                </fieldset>
              </TabsContent>

              {/* ----------------------------------------------------- review -- */}
              <TabsContent value="review">
                <dl className="divide-y divide-border rounded-lg border border-border">
                  {review.map((entry) => (
                    <div key={entry.label} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[12rem_1fr]">
                      <dt className="text-sm text-muted-foreground">{entry.label}</dt>
                      <dd className="text-sm">{entry.value}</dd>
                    </div>
                  ))}
                </dl>
              </TabsContent>
            </Tabs>
          )}
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {step !== 'review' ? (
            <Button type="button" variant="outline" onClick={() => setStep('review')} disabled={loading || Boolean(loadError)}>
              Review
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => void save('draft')} disabled={loading || Boolean(loadError) || saving}>
            Save as draft
          </Button>
          <Button type="button" loading={saving} onClick={() => void save()} disabled={loading || Boolean(loadError)}>
            Save discount
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------- pieces --

function ToggleRow({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 text-sm">
      <Switch checked={checked} onCheckedChange={onChange} />
      {label}
    </label>
  );
}

function CheckList<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T[];
  onChange: (next: T[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const on = value.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((entry) => entry !== option.value) : [...value, option.value])}
            className={cn(
              'rounded-md border px-3 py-1.5 text-sm transition-colors',
              on ? 'border-primary bg-primary-soft' : 'border-border hover:border-border-strong',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function NumberField({
  id,
  label,
  hint,
  error,
  min = 1,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  min?: number;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error}>
      <Input
        id={id}
        type="number"
        min={min}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
      />
    </Field>
  );
}

/**
 * A comma-separated list typed as text. Held as the owner typed it while the box
 * has focus, so a trailing comma is not eaten before the next entry is written.
 */
function ListInput({ id, value, onChange }: { id: string; value: string[]; onChange: (next: string[]) => void }) {
  const [text, setText] = React.useState(listText(value));
  const [focused, setFocused] = React.useState(false);
  const shown = focused ? text : listText(value);

  return (
    <Input
      id={id}
      value={shown}
      onFocus={() => {
        setText(listText(value));
        setFocused(true);
      }}
      onBlur={() => setFocused(false)}
      onChange={(event) => {
        setText(event.target.value);
        onChange(splitList(event.target.value));
      }}
    />
  );
}
