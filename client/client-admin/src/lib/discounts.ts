import { formatMoney, formatNumber } from './format';
import type {
  CardType,
  CombinableClass,
  CustomerGroup,
  CustomerSegment,
  DiscountAreaRules,
  DiscountCombinationRules,
  DiscountCustomerRules,
  DiscountKind,
  DiscountPaymentRules,
  DiscountProductRules,
  DiscountPurchaseRules,
  DiscountRecord,
  DiscountRewardRules,
  DiscountScheduleRules,
  DiscountState,
  DiscountStatus,
  DiscountStrategy,
  DiscountValueType,
  DiscountView,
  IssueEvent,
  PaymentCondition,
} from './types';

/**
 * How the panel talks about a discount.
 *
 * One file for the list's cells, the editor's review step and the detail panel,
 * so the three describe a rule in the same words — an owner who reads "Islami
 * Bank credit cards" in the preview must read it again on the row. No
 * `'use client'` directive, for the reason `lib/list.ts` carries none: a server
 * component reads these too, and a value exported from a client module is a
 * reference rather than the value.
 *
 * The API decides; this only describes. Nothing here is consulted at checkout.
 */

// ------------------------------------------------------------ vocabulary --

export const KIND_META: Record<DiscountKind, { label: string; description: string; short: string }> = {
  coupon: { label: 'Coupon code', short: 'Coupon', description: 'Customer enters a code at checkout.' },
  automatic: {
    label: 'Automatic discount',
    short: 'Automatic',
    description: 'Applied on its own when the basket meets the rules. No code.',
  },
  voucher: { label: 'Voucher', short: 'Voucher', description: 'Attached to a customer’s account, used once.' },
  campaign: { label: 'Campaign', short: 'Campaign', description: 'A store-wide promotion that runs on its own.' },
  bank_offer: { label: 'Bank / card offer', short: 'Bank offer', description: 'A discount for cards from selected banks.' },
  payment_offer: {
    label: 'Payment method offer',
    short: 'Payment offer',
    description: 'A discount for bKash, Nagad, Rocket, cards or cash on delivery.',
  },
};

export const KIND_ORDER: DiscountKind[] = ['coupon', 'automatic', 'voucher', 'campaign', 'bank_offer', 'payment_offer'];

/** Kinds whose code is required, and kinds that never have one. */
export const codeRequired = (kind: DiscountKind) => kind === 'coupon';
export const codeless = (kind: DiscountKind) => kind === 'automatic' || kind === 'campaign';
export const codeOptional = (kind: DiscountKind) => kind === 'bank_offer' || kind === 'payment_offer' || kind === 'voucher';

export const VALUE_TYPE_META: Record<DiscountValueType, { label: string; description: string }> = {
  percentage: { label: 'Percentage off', description: 'A share of the eligible items, with an optional ceiling.' },
  fixed_amount: { label: 'Fixed amount off', description: 'A set amount off the eligible items.' },
  buy_x_get_y: { label: 'Buy X get Y', description: 'Buy some items, get others free or cheaper.' },
  fixed_price: { label: 'Fixed product price', description: 'Every eligible item sells for one price.' },
  bundle: { label: 'Bundle price', description: 'A set of products bought together for one price.' },
};

export const STATE_META: Record<DiscountState, { label: string; variant: 'success' | 'info' | 'neutral' | 'warning' | 'primary' | 'danger' }> = {
  active: { label: 'Active', variant: 'success' },
  scheduled: { label: 'Scheduled', variant: 'info' },
  paused: { label: 'Paused', variant: 'warning' },
  draft: { label: 'Draft', variant: 'neutral' },
  expired: { label: 'Expired', variant: 'neutral' },
  limit_reached: { label: 'Limit reached', variant: 'primary' },
};

export const PAYMENT_LABELS: Record<PaymentCondition, string> = {
  cod: 'Cash on delivery',
  card: 'Any card',
  credit_card: 'Credit card',
  debit_card: 'Debit card',
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  bkash: 'bKash',
  nagad: 'Nagad',
  rocket: 'Rocket',
  bank_transfer: 'Bank transfer',
};

export const PAYMENT_ORDER: PaymentCondition[] = [
  'cod',
  'card',
  'credit_card',
  'debit_card',
  'visa',
  'mastercard',
  'amex',
  'bkash',
  'nagad',
  'rocket',
  'bank_transfer',
];

export const CARD_TYPE_LABELS: Record<CardType, string> = { credit: 'Credit', debit: 'Debit', prepaid: 'Prepaid' };

export const SEGMENT_META: Record<CustomerSegment, { label: string; description: string }> = {
  all: { label: 'All customers', description: 'Anyone, signed in or not.' },
  new: { label: 'New customers — first order only', description: 'Customers with no previous order.' },
  returning: { label: 'Returning customers', description: 'Customers who have ordered before.' },
  vip: { label: 'VIP customers', description: 'Customers you have marked VIP on their customer page.' },
  groups: { label: 'Selected customer groups', description: 'Customers in the groups you pick.' },
  selected: { label: 'Selected customers', description: 'Only the customers you name.' },
};

export const GROUP_LABELS: Record<CustomerGroup, string> = {
  new: 'New',
  repeat: 'Repeat',
  vip: 'VIP',
  high_value: 'High value',
};

export const ISSUE_EVENT_META: Record<IssueEvent, { label: string; threshold?: string }> = {
  registration: { label: 'When a customer registers' },
  first_order: { label: 'After their first delivered order' },
  order_count: { label: 'After a number of delivered orders', threshold: 'Delivered orders' },
  total_spent: { label: 'After they have spent a total', threshold: 'Total spent' },
  birthday: { label: 'On their birthday' },
  win_back: { label: 'When they have not ordered for a while', threshold: 'Days without an order' },
};

export const COMBINABLE_LABELS: Record<CombinableClass, string> = {
  coupon: 'Other coupon codes',
  automatic: 'Automatic discounts',
  bank_offer: 'Bank & payment offers',
  product: 'Product discounts',
  voucher: 'Vouchers',
};

export const STRATEGY_META: Record<DiscountStrategy, { label: string; description: string }> = {
  best: {
    label: 'Use the best discount',
    description: 'When several automatic discounts match, only the one worth most to the customer applies.',
  },
  priority: {
    label: 'Use the highest priority',
    description: 'Only the matching automatic discount with the lowest priority number applies.',
  },
  stack: {
    label: 'Stack eligible discounts',
    description: 'Every matching automatic discount applies, in priority order, where their combination rules allow.',
  },
};

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Saturday first: the Bangladeshi working week, and the order a shopkeeper there reads a week in. */
export const DAY_ORDER = [6, 0, 1, 2, 3, 4, 5];

// ------------------------------------------------------------- the rules --

export interface DiscountRules {
  product: DiscountProductRules;
  purchase: DiscountPurchaseRules;
  reward: DiscountRewardRules;
  customer: DiscountCustomerRules;
  payment: DiscountPaymentRules;
  area: DiscountAreaRules;
  schedule: DiscountScheduleRules;
  combination: DiscountCombinationRules;
}

const DEFAULT_RULES: DiscountRules = {
  product: {
    appliesTo: 'all',
    productIds: [],
    variantIds: [],
    categoryIds: [],
    brandIds: [],
    collectionIds: [],
    excludeProductIds: [],
    excludeCategoryIds: [],
    excludeBrandIds: [],
    excludeSaleItems: false,
    excludeDiscountedItems: false,
  },
  purchase: { requiredProductIds: [], requiredCategoryIds: [], requiredBrandIds: [] },
  reward: {
    buyQuantity: 1,
    buyProductIds: [],
    buyCategoryIds: [],
    getQuantity: 1,
    getProductIds: [],
    getCategoryIds: [],
    getDiscountPercent: 100,
    maxApplications: null,
  },
  customer: {
    segment: 'all',
    groups: [],
    minPreviousOrders: null,
    registeredWithinDays: null,
    inactiveDays: null,
    birthdayWindowDays: null,
    limitByIdentity: false,
  },
  payment: { channels: [], bankIds: [], cardTypes: [], cardPrefixes: [] },
  area: { countries: [], cities: [] },
  schedule: { days: [], startTime: null, endTime: null },
  combination: { mode: 'none', with: [] },
};

/** A stored discount's rules with every missing key filled in. */
export function rulesOf(record: Pick<DiscountRecord, 'productRules' | 'purchaseRules' | 'rewardRules' | 'customerRules' | 'paymentRules' | 'areaRules' | 'scheduleRules' | 'combinationRules'>): DiscountRules {
  return {
    product: { ...DEFAULT_RULES.product, ...record.productRules },
    purchase: { ...DEFAULT_RULES.purchase, ...record.purchaseRules },
    reward: { ...DEFAULT_RULES.reward, ...record.rewardRules },
    customer: { ...DEFAULT_RULES.customer, ...record.customerRules },
    payment: { ...DEFAULT_RULES.payment, ...record.paymentRules },
    area: { ...DEFAULT_RULES.area, ...record.areaRules },
    schedule: { ...DEFAULT_RULES.schedule, ...record.scheduleRules },
    combination: { ...DEFAULT_RULES.combination, ...record.combinationRules },
  };
}

// --------------------------------------------------------------- sentences --

type Describable = Pick<
  DiscountRecord,
  | 'kind'
  | 'valueType'
  | 'value'
  | 'maxDiscountAmount'
  | 'minOrderAmount'
  | 'minQuantity'
  | 'maxDiscountedQuantity'
  | 'minSubtotalAfterDiscount'
  | 'usageLimit'
  | 'perCustomerLimit'
  | 'usedCount'
  | 'cooldownAmount'
  | 'cooldownUnit'
  | 'startsAt'
  | 'endsAt'
  | 'productRules'
  | 'purchaseRules'
  | 'rewardRules'
  | 'customerRules'
  | 'paymentRules'
  | 'areaRules'
  | 'scheduleRules'
  | 'combinationRules'
  | 'issueRules'
>;

/** Looks an id up in whichever label map the caller holds; an unknown id reads as "1 item". */
type Names = (id: string) => string | undefined;

const trim = (value: string | number) => {
  const number = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
};

function listWords(words: string[], joiner = 'or'): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} ${joiner} ${words[words.length - 1]}`;
}

function named(ids: string[], names: Names, noun: string): string {
  const found = ids.map(names).filter((name): name is string => Boolean(name));
  if (found.length === 0) return `${ids.length} ${ids.length === 1 ? noun : `${noun}s`}`;
  if (found.length > 2) return `${found.slice(0, 2).join(', ')} +${ids.length - 2}`;
  return found.join(', ');
}

/** "10% off", "৳250 off", "Buy 2 get 1 free" — what the offer is, before any condition. */
export function offerText(record: Describable, currency: string): string {
  const reward = rulesOf(record).reward;
  switch (record.valueType) {
    case 'percentage':
      return `${trim(record.value)}% off`;
    case 'fixed_amount':
      return `${formatMoney(record.value, currency)} off`;
    case 'fixed_price':
      return `Each for ${formatMoney(record.value, currency)}`;
    case 'bundle':
      return `Bundle for ${formatMoney(record.value, currency)}`;
    case 'buy_x_get_y':
      return `Buy ${reward.buyQuantity} get ${reward.getQuantity} ${reward.getDiscountPercent >= 100 ? 'free' : `${trim(reward.getDiscountPercent)}% off`}`;
  }
}

export function capText(record: Describable, currency: string): string | null {
  return record.maxDiscountAmount ? `Maximum ${formatMoney(record.maxDiscountAmount, currency)}` : null;
}

/** What the products have to be. */
export function productText(record: Describable, names: Names): string {
  const product = rulesOf(record).product;
  const reward = rulesOf(record).reward;

  if (record.valueType === 'bundle') return `Bundle: ${named(product.productIds, names, 'product')}`;
  if (record.valueType === 'buy_x_get_y') {
    const buy = [...reward.buyProductIds, ...reward.buyCategoryIds];
    const get = [...reward.getProductIds, ...reward.getCategoryIds];
    return `Buy ${buy.length ? named(buy, names, 'item') : 'any eligible item'}${get.length ? ` · get ${named(get, names, 'item')}` : ''}`;
  }

  const parts: string[] = [];
  if (product.appliesTo === 'specific') {
    const targets = [...product.categoryIds, ...product.brandIds, ...product.collectionIds, ...product.productIds, ...product.variantIds];
    parts.push(`Only ${named(targets, names, 'item')}`);
  } else {
    parts.push('Entire store');
  }
  const excluded = [...product.excludeCategoryIds, ...product.excludeBrandIds, ...product.excludeProductIds];
  if (excluded.length) parts.push(`except ${named(excluded, names, 'item')}`);
  if (product.excludeSaleItems) parts.push('not on sale items');
  if (product.excludeDiscountedItems) parts.push('not on items already discounted');
  return parts.join(', ');
}

/** The conditions a basket must meet, as short phrases for the list's column. */
export function conditionPhrases(record: Describable, currency: string, names: Names): string[] {
  const rules = rulesOf(record);
  const phrases: string[] = [];

  if (record.minOrderAmount) phrases.push(`Minimum order ${formatMoney(record.minOrderAmount, currency)}`);
  if (record.minQuantity) phrases.push(`At least ${record.minQuantity} items`);

  const required = [...rules.purchase.requiredProductIds, ...rules.purchase.requiredCategoryIds, ...rules.purchase.requiredBrandIds];
  if (required.length) phrases.push(`Needs ${named(required, names, 'item')}`);

  if (rules.product.appliesTo === 'specific' || record.valueType === 'bundle' || record.valueType === 'buy_x_get_y') {
    phrases.push(productText(record, names));
  }

  const payment = paymentText(record, names);
  if (payment) phrases.push(payment);

  const places = [...rules.area.cities, ...rules.area.countries];
  if (places.length) phrases.push(`Delivered to ${listWords(places)}`);

  const clock = clockText(record);
  if (clock) phrases.push(clock);

  if (record.customerRules && rules.customer.segment === 'new' && record.kind !== 'voucher') phrases.push('First order only');

  return phrases;
}

export function paymentText(record: Pick<DiscountRecord, 'paymentRules'>, names: Names): string | null {
  const payment = { ...DEFAULT_RULES.payment, ...record.paymentRules };
  const parts: string[] = [];
  if (payment.bankIds.length) {
    const type = payment.cardTypes.length === 1 ? ` ${CARD_TYPE_LABELS[payment.cardTypes[0]!].toLowerCase()}` : '';
    parts.push(`${named(payment.bankIds, names, 'bank')}${type} card`);
  }
  if (payment.channels.length) parts.push(listWords(payment.channels.map((channel) => PAYMENT_LABELS[channel])));
  if (payment.cardPrefixes.length) parts.push(`cards starting ${payment.cardPrefixes.slice(0, 2).join(', ')}${payment.cardPrefixes.length > 2 ? '…' : ''}`);
  return parts.length ? parts.join(' · ') : null;
}

export function customerText(record: Describable & { customerCount?: number }): string {
  const rules = rulesOf(record).customer;
  if (record.kind === 'voucher') {
    const issued = record.issueRules ? ISSUE_EVENT_META[record.issueRules.event].label.toLowerCase() : null;
    const holders = record.customerCount !== undefined ? `${formatNumber(record.customerCount)} holders` : 'Voucher holders';
    return issued ? `${holders} · issued ${issued}` : holders;
  }
  const base =
    rules.segment === 'groups'
      ? `Groups: ${rules.groups.map((group) => GROUP_LABELS[group]).join(', ')}`
      : rules.segment === 'selected'
        ? record.customerCount !== undefined
          ? `${formatNumber(record.customerCount)} selected customers`
          : 'Selected customers'
        : rules.segment === 'new'
          ? 'New customers'
          : SEGMENT_META[rules.segment].label;

  const extras: string[] = [];
  if (rules.minPreviousOrders) extras.push(`${rules.minPreviousOrders}+ orders`);
  if (rules.registeredWithinDays) extras.push(`joined in last ${rules.registeredWithinDays} days`);
  if (rules.inactiveDays) extras.push(`away ${rules.inactiveDays}+ days`);
  if (rules.birthdayWindowDays !== null) extras.push('birthday');
  return extras.length ? `${base} · ${extras.join(', ')}` : base;
}

export function usageText(record: Pick<DiscountRecord, 'usedCount' | 'usageLimit'>): string {
  return record.usageLimit === null
    ? `${formatNumber(record.usedCount)} ${record.usedCount === 1 ? 'use' : 'uses'}`
    : `${formatNumber(record.usedCount)} / ${formatNumber(record.usageLimit)}`;
}

export function repeatText(record: Pick<DiscountRecord, 'perCustomerLimit' | 'cooldownAmount' | 'cooldownUnit'>): string {
  const parts: string[] = [];
  if (record.cooldownAmount && record.cooldownUnit) {
    parts.push(
      record.cooldownAmount === 1 && record.cooldownUnit === 'day'
        ? 'Once per day'
        : `Once every ${record.cooldownAmount} ${record.cooldownUnit}${record.cooldownAmount === 1 ? '' : 's'}`,
    );
  }
  if (record.perCustomerLimit === 1 && parts.length === 0) return 'Once per customer';
  if (record.perCustomerLimit) parts.push(`maximum ${record.perCustomerLimit} per customer`);
  return parts.length ? parts.join(', ') : 'Unlimited per customer';
}

function shortDate(iso: string, timeZone: string, withYear = false): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
      timeZone,
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function longDateTime(iso: string | null, timeZone: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** "No expiry", "Until 30 Sep", "1 Sep – 30 Sep". */
export function scheduleText(record: Pick<DiscountRecord, 'startsAt' | 'endsAt'>, timeZone: string): string {
  const year = new Date().getFullYear();
  const needsYear = (iso: string | null) => Boolean(iso) && new Date(iso!).getFullYear() !== year;
  if (!record.startsAt && !record.endsAt) return 'No expiry';
  if (!record.startsAt) return `Until ${shortDate(record.endsAt!, timeZone, needsYear(record.endsAt))}`;
  if (!record.endsAt) return `From ${shortDate(record.startsAt, timeZone, needsYear(record.startsAt))}`;
  return `${shortDate(record.startsAt, timeZone, needsYear(record.startsAt))} – ${shortDate(record.endsAt, timeZone, needsYear(record.endsAt))}`;
}

/** "12-hour" clock text for a stored `HH:mm`. */
export function clock12(value: string): string {
  const [hh = 0, mm = 0] = value.split(':').map(Number);
  const suffix = hh < 12 ? 'AM' : 'PM';
  return `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, '0')} ${suffix}`;
}

/** "Fri–Sun, 6:00 PM – 11:59 PM", or null when it runs every day at every hour. */
export function clockText(record: Pick<DiscountRecord, 'scheduleRules'>): string | null {
  const schedule = { ...DEFAULT_RULES.schedule, ...record.scheduleRules };
  const parts: string[] = [];
  if (schedule.days.length && schedule.days.length < 7) {
    const ordered = DAY_ORDER.filter((day) => schedule.days.includes(day));
    parts.push(ordered.map((day) => DAY_SHORT[day]).join(', '));
  }
  if (schedule.startTime && schedule.endTime) parts.push(`${clock12(schedule.startTime)} – ${clock12(schedule.endTime)}`);
  return parts.length ? parts.join(' · ') : null;
}

export function combinationText(record: Pick<DiscountRecord, 'combinationRules'>): string {
  const rules = { ...DEFAULT_RULES.combination, ...record.combinationRules };
  if (rules.mode === 'all') return 'Combines with every other offer';
  if (rules.mode === 'none' || rules.with.length === 0) return 'Cannot be combined with other offers';
  return `Combines with ${listWords(rules.with.map((entry) => COMBINABLE_LABELS[entry].toLowerCase()), 'and')}`;
}

/**
 * The whole rule in sentences — the editor's Review step and the detail panel's
 * summary are this list, so what the owner approved is what they read back.
 */
export function previewRows(
  record: Describable & { code: string | null; name: string; customerCount?: number },
  context: { currency: string; timeZone: string; names: Names; strategy?: DiscountStrategy },
): { label: string; value: string }[] {
  const rules = rulesOf(record);
  const rows: { label: string; value: string }[] = [];
  const add = (label: string, value: string | null | undefined) => {
    if (value) rows.push({ label, value });
  };

  add('Applied by', record.code ? `${KIND_META[record.kind].short} — code ${record.code}` : `${KIND_META[record.kind].short} — no code needed`);
  add('Customer receives', offerText(record, context.currency));
  add('Maximum discount', capText(record, context.currency)?.replace('Maximum ', ''));
  add(
    'Requires',
    [
      record.minOrderAmount ? `Minimum purchase ${formatMoney(record.minOrderAmount, context.currency)}` : null,
      record.minQuantity ? `at least ${record.minQuantity} eligible items` : null,
      [...rules.purchase.requiredProductIds, ...rules.purchase.requiredCategoryIds, ...rules.purchase.requiredBrandIds].length
        ? `${named([...rules.purchase.requiredProductIds, ...rules.purchase.requiredCategoryIds, ...rules.purchase.requiredBrandIds], context.names, 'item')} in the basket`
        : null,
    ]
      .filter(Boolean)
      .join(', ') || 'No minimum requirement',
  );
  add('Applies to', productText(record, context.names));
  add('Eligible customers', customerText(record));
  const customerExtras = [
    rules.customer.limitByIdentity ? 'Accounts sharing an email or phone count as one customer' : null,
  ].filter(Boolean);
  if (customerExtras.length) add('Abuse protection', customerExtras.join(', '));
  add('Payment', paymentText(record, context.names) ?? 'Any payment method');
  const places = [...rules.area.cities, ...rules.area.countries];
  if (places.length) add('Delivery area', listWords(places));
  add('Usage', `${record.usageLimit ? `${formatNumber(record.usageLimit)} uses in total` : 'Unlimited in total'} · ${repeatText(record)}`);
  add('Available', scheduleTextLong(record, context.timeZone));
  add('Days & times', clockText(record) ?? 'Every day, all day');
  add('Stacking', combinationText(record));
  const protections = [
    record.maxDiscountedQuantity ? `Discounts at most ${record.maxDiscountedQuantity} items` : null,
    record.minSubtotalAfterDiscount ? `Order must stay above ${formatMoney(record.minSubtotalAfterDiscount, context.currency)} after discounts` : null,
  ].filter(Boolean);
  if (protections.length) add('Protection', protections.join(' · '));
  if (record.issueRules) {
    const meta = ISSUE_EVENT_META[record.issueRules.event];
    const threshold =
      record.issueRules.threshold !== null
        ? record.issueRules.event === 'total_spent'
          ? ` (${formatMoney(record.issueRules.threshold, context.currency)})`
          : ` (${record.issueRules.threshold})`
        : '';
    add(
      'Issued',
      `${meta.label}${threshold}${record.issueRules.validDays ? ` · valid ${record.issueRules.validDays} days` : ''}`,
    );
  }
  return rows;
}

function scheduleTextLong(record: Pick<DiscountRecord, 'startsAt' | 'endsAt'>, timeZone: string): string {
  if (!record.startsAt && !record.endsAt) return 'From now, no expiry';
  if (!record.startsAt) return `Until ${longDateTime(record.endsAt, timeZone)}`;
  if (!record.endsAt) return `From ${longDateTime(record.startsAt, timeZone)}, no expiry`;
  return `${longDateTime(record.startsAt, timeZone)} – ${longDateTime(record.endsAt, timeZone)}`;
}

// ------------------------------------------------------------------ drafts --

/**
 * What the editor holds while a discount is being written.
 *
 * Numbers the owner types stay strings until they are sent, so an empty box is
 * "not set" rather than a zero, and the repeat-use choice is kept as the choice
 * the owner made rather than as the two columns it becomes.
 */
export interface DiscountDraft {
  kind: DiscountKind;
  name: string;
  code: string;
  title: string;
  summary: string;
  notes: string;
  valueType: DiscountValueType;
  value: string;
  maxDiscountAmount: string;
  minOrderAmount: string;
  minQuantity: string;
  maxDiscountedQuantity: string;
  minSubtotalAfterDiscount: string;
  rules: DiscountRules;
  customerIds: string[];
  usageLimit: string;
  repeat: 'unlimited' | 'once' | 'daily' | 'interval';
  cooldownAmount: string;
  cooldownUnit: 'day' | 'week' | 'month';
  lifetimeLimit: string;
  startsAt: string;
  endsAt: string;
  noExpiry: boolean;
  timezone: string;
  priority: string;
  issueEnabled: boolean;
  issue: { event: IssueEvent; threshold: string; validDays: string };
  status: DiscountStatus;
}

export function emptyDraft(kind: DiscountKind = 'coupon'): DiscountDraft {
  const rules = structuredClone(DEFAULT_RULES);
  if (kind === 'payment_offer') rules.payment.channels = ['bkash'];
  return {
    kind,
    name: '',
    code: '',
    title: '',
    summary: '',
    notes: '',
    valueType: 'percentage',
    value: '',
    maxDiscountAmount: '',
    minOrderAmount: '',
    minQuantity: '',
    maxDiscountedQuantity: '',
    minSubtotalAfterDiscount: '',
    rules,
    customerIds: [],
    usageLimit: '',
    repeat: kind === 'voucher' ? 'once' : 'unlimited',
    cooldownAmount: '30',
    cooldownUnit: 'day',
    lifetimeLimit: '',
    startsAt: '',
    endsAt: '',
    noExpiry: true,
    timezone: '',
    priority: '10',
    issueEnabled: false,
    issue: { event: 'registration', threshold: '', validDays: '30' },
    status: 'active',
  };
}

const text = (value: string | number | null | undefined) => (value === null || value === undefined ? '' : String(value));

export function draftFromView(view: DiscountView): DiscountDraft {
  const repeat: DiscountDraft['repeat'] =
    view.cooldownAmount && view.cooldownUnit
      ? view.cooldownAmount === 1 && view.cooldownUnit === 'day'
        ? 'daily'
        : 'interval'
      : view.perCustomerLimit === 1
        ? 'once'
        : 'unlimited';

  return {
    kind: view.kind,
    name: view.name,
    code: view.code ?? '',
    title: view.title ?? '',
    summary: view.summary ?? '',
    notes: view.notes ?? '',
    valueType: view.valueType,
    value: view.valueType === 'buy_x_get_y' ? '' : trim(view.value),
    maxDiscountAmount: view.maxDiscountAmount ? trim(view.maxDiscountAmount) : '',
    minOrderAmount: view.minOrderAmount ? trim(view.minOrderAmount) : '',
    minQuantity: text(view.minQuantity),
    maxDiscountedQuantity: text(view.maxDiscountedQuantity),
    minSubtotalAfterDiscount: view.minSubtotalAfterDiscount ? trim(view.minSubtotalAfterDiscount) : '',
    rules: rulesOf(view),
    customerIds: view.customerIds,
    usageLimit: text(view.usageLimit),
    repeat,
    cooldownAmount: text(view.cooldownAmount ?? 30),
    cooldownUnit: view.cooldownUnit ?? 'day',
    lifetimeLimit: repeat === 'once' ? '' : text(view.perCustomerLimit),
    startsAt: view.startsAtLocal ?? '',
    endsAt: view.endsAtLocal ?? '',
    noExpiry: !view.endsAtLocal,
    timezone: view.timezone ?? '',
    priority: String(view.priority),
    issueEnabled: view.issueRules !== null,
    issue: view.issueRules
      ? {
          event: view.issueRules.event,
          threshold: text(view.issueRules.threshold),
          validDays: text(view.issueRules.validDays),
        }
      : { event: 'registration', threshold: '', validDays: '30' },
    status: view.status,
  };
}

const orNull = (value: string) => (value.trim() === '' ? null : value.trim());
const intOrNull = (value: string) => (value.trim() === '' ? null : Number.parseInt(value, 10));

/** The body `POST`/`PUT /discounts` takes — every group, always, so an edit cannot leave half an old rule behind. */
export function payloadFromDraft(draft: DiscountDraft, status: DiscountStatus = draft.status) {
  const { rules } = draft;
  const isVoucher = draft.kind === 'voucher';

  const perCustomerLimit =
    draft.repeat === 'once' ? 1 : intOrNull(draft.lifetimeLimit);
  const cooldown =
    draft.repeat === 'daily'
      ? { amount: 1, unit: 'day' as const }
      : draft.repeat === 'interval'
        ? { amount: intOrNull(draft.cooldownAmount), unit: draft.cooldownUnit }
        : { amount: null, unit: null };

  const needsCustomerList = isVoucher || rules.customer.segment === 'selected';

  return {
    kind: draft.kind,
    name: draft.name.trim(),
    code: codeless(draft.kind) ? null : orNull(draft.code.toUpperCase()),
    title: orNull(draft.title),
    summary: orNull(draft.summary),
    notes: orNull(draft.notes),
    valueType: draft.valueType,
    value: draft.valueType === 'buy_x_get_y' ? '0' : draft.value.trim() || '0',
    maxDiscountAmount: orNull(draft.maxDiscountAmount),
    minOrderAmount: orNull(draft.minOrderAmount),
    minQuantity: intOrNull(draft.minQuantity),
    maxDiscountedQuantity: intOrNull(draft.maxDiscountedQuantity),
    minSubtotalAfterDiscount: orNull(draft.minSubtotalAfterDiscount),
    productRules: rules.product,
    purchaseRules: rules.purchase,
    rewardRules: rules.reward,
    customerRules: isVoucher ? { ...rules.customer, segment: 'all' as const } : rules.customer,
    customerIds: needsCustomerList ? draft.customerIds : [],
    paymentRules: rules.payment,
    areaRules: rules.area,
    usageLimit: intOrNull(draft.usageLimit),
    perCustomerLimit,
    cooldownAmount: cooldown.amount,
    cooldownUnit: cooldown.amount === null ? null : cooldown.unit,
    startsAt: orNull(draft.startsAt),
    endsAt: draft.noExpiry ? null : orNull(draft.endsAt),
    timezone: orNull(draft.timezone),
    scheduleRules: {
      days: rules.schedule.days,
      startTime: rules.schedule.startTime || null,
      endTime: rules.schedule.endTime || null,
    },
    combinationRules: rules.combination,
    priority: intOrNull(draft.priority) ?? 10,
    issueRules:
      isVoucher && draft.issueEnabled
        ? {
            event: draft.issue.event,
            threshold: draft.issue.threshold.trim() === '' ? null : Number(draft.issue.threshold),
            validDays: intOrNull(draft.issue.validDays),
          }
        : null,
    status,
  };
}

/** The draft as a record the sentence helpers above can read, for the Review step. */
export function recordFromDraft(draft: DiscountDraft): Describable & { code: string | null; name: string } {
  const payload = payloadFromDraft(draft);
  return {
    ...payload,
    code: payload.code,
    value: payload.value,
    usedCount: 0,
    // Wall-clock times written as UTC instants, so a caller formatting them in
    // UTC prints exactly what the owner typed, whatever zone the browser is in.
    startsAt: payload.startsAt ? `${payload.startsAt}:00Z` : null,
    endsAt: payload.endsAt ? `${payload.endsAt}:00Z` : null,
  } as Describable & { code: string | null; name: string };
}
