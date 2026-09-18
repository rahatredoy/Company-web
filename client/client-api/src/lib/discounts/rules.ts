import { z } from 'zod';
import { moneySchema } from '../validation';

/**
 * The vocabulary of a discount.
 *
 * A discount is **rules and an action**, not a kind of coupon. What it takes
 * off (`valueType`) is one decision; who may have it, on what, paid how and
 * when are separate groups of conditions that any discount can carry. That is
 * what lets "10% off" and "15% off, max ৳1,000, over ৳5,000, Islami Bank credit
 * cards, Friday to Sunday, once every 30 days, three times ever" be the same
 * row with more of it filled in — and one engine (`engine.ts`) the only thing
 * that reads them.
 *
 * Every set-shaped rule is stored as a jsonb group and parsed through the
 * schemas below on the way in, so the engine can trust the shape it reads back.
 * The storefront never sees this file: it asks the API what a basket is worth.
 */

// ------------------------------------------------------------------ kinds --

/**
 * How a discount is triggered, in the owner's own terms.
 *
 * `coupon` and `voucher` always have a code; `automatic` and `campaign` never
 * do; a bank or payment offer may be either — typed at the till, or applied the
 * moment an eligible card or wallet is chosen. The database enforces the same
 * three cases (`discounts_code_by_kind_check`).
 */
export const DISCOUNT_KINDS = ['coupon', 'automatic', 'voucher', 'campaign', 'bank_offer', 'payment_offer'] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

export const CODE_REQUIRED_KINDS: readonly DiscountKind[] = ['coupon', 'voucher'];
export const CODELESS_KINDS: readonly DiscountKind[] = ['automatic', 'campaign'];

/** What a discount takes off. */
export const DISCOUNT_VALUE_TYPES = [
  'percentage',
  'fixed_amount',
  'buy_x_get_y',
  'fixed_price',
  'bundle',
] as const;
export type DiscountValueType = (typeof DISCOUNT_VALUE_TYPES)[number];

/** What the owner set. `scheduled`, `expired` and `limit_reached` are read off the clock and the counter. */
export const DISCOUNT_STATUSES = ['draft', 'active', 'paused'] as const;
export type DiscountStatus = (typeof DISCOUNT_STATUSES)[number];

/** What the list shows: the owner's status, and what the clock and the counter say about it. */
export const DISCOUNT_STATES = ['draft', 'scheduled', 'active', 'paused', 'expired', 'limit_reached'] as const;
export type DiscountState = (typeof DISCOUNT_STATES)[number];

// ---------------------------------------------------------------- payment --

/**
 * What a shopper can say they are paying with.
 *
 * Deliberately short: these are instruments, not brands of card. Which of them
 * a provider can take is `PROVIDER_CHANNELS` — a cash-on-delivery order cannot
 * be paid by bKash, and a card network is read off the card's own number.
 */
export const PAYMENT_CHANNEL_CHOICES = ['cod', 'card', 'bkash', 'nagad', 'rocket', 'bank_transfer'] as const;
export type PaymentChannelChoice = (typeof PAYMENT_CHANNEL_CHOICES)[number];

/**
 * What an offer can require of a payment. A superset of the choices above:
 * `visa` is a `card` whose number starts the way Visa numbers do, and
 * `credit_card` is a `card` whose prefix a bank on file lists as credit.
 */
export const PAYMENT_CONDITIONS = [
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
] as const;
export type PaymentCondition = (typeof PAYMENT_CONDITIONS)[number];

/**
 * Which instruments each payment adapter can take.
 *
 * Platform knowledge rather than store data: it describes what the adapter
 * speaks, not what a shop has switched on — that is `payment_methods`.
 * SSLCommerz and the test gateway both hand the shopper a page offering cards
 * and the Bangladeshi wallets.
 */
export const PROVIDER_CHANNELS: Record<string, readonly PaymentChannelChoice[]> = {
  cod: ['cod'],
  mock: ['card', 'bkash', 'nagad', 'rocket', 'bank_transfer'],
  sslcommerz: ['card', 'bkash', 'nagad', 'rocket', 'bank_transfer'],
  stripe: ['card'],
};

export const CARD_TYPES = ['credit', 'debit', 'prepaid'] as const;
export type CardType = (typeof CARD_TYPES)[number];

/**
 * A card number prefix a bank has issued.
 *
 * Six to eight digits — the issuer identification number. It is what a card
 * offer is actually checked against: "Islami Bank card" is not something the
 * shop can see, and a prefix is.
 */
export const cardPrefixSchema = z.object({
  prefix: z.string().trim().regex(/^\d{6,8}$/, 'Use the first 6 to 8 digits of the card number.'),
  cardType: z.enum(CARD_TYPES).nullable().default(null),
  label: z.string().trim().max(60).nullable().default(null),
});
export type CardPrefix = z.infer<typeof cardPrefixSchema>;

// ------------------------------------------------------------ rule groups --

const ids = (max = 500) => z.array(z.string().uuid('Pick an item from the list.')).max(max).default([]);

/**
 * What the discount is taken off.
 *
 * `specific` with more than one list is a union — "Samsung and Google" is two
 * brands, either of which qualifies. Exclusions always win over inclusions,
 * which is what makes "everything except Apple" one rule rather than a list of
 * every other brand.
 */
export const productRulesSchema = z.object({
  appliesTo: z.enum(['all', 'specific']).default('all'),
  productIds: ids(),
  variantIds: ids(),
  categoryIds: ids(),
  brandIds: ids(),
  collectionIds: ids(),
  excludeProductIds: ids(),
  excludeCategoryIds: ids(),
  excludeBrandIds: ids(),
  /** A line whose variant has a live sale price. */
  excludeSaleItems: z.boolean().default(false),
  /** A line another discount on the same order has already taken something off. */
  excludeDiscountedItems: z.boolean().default(false),
});
export type ProductRules = z.infer<typeof productRulesSchema>;

/** What the basket must contain before the discount is offered at all. */
export const purchaseRulesSchema = z.object({
  requiredProductIds: ids(),
  requiredCategoryIds: ids(),
  requiredBrandIds: ids(),
});
export type PurchaseRules = z.infer<typeof purchaseRulesSchema>;

/**
 * Buy X, get Y — and the one bound a bundle shares with it.
 *
 * Empty buy lists mean "anything the product rules allow"; empty get lists mean
 * "the same pool as the buy side", which is what Buy 2 Get 1 Free on a whole
 * category needs. `getDiscountPercent` 100 is free.
 */
export const rewardRulesSchema = z.object({
  buyQuantity: z.coerce.number().int().min(1).max(100).default(1),
  buyProductIds: ids(),
  buyCategoryIds: ids(),
  getQuantity: z.coerce.number().int().min(1).max(100).default(1),
  getProductIds: ids(),
  getCategoryIds: ids(),
  getDiscountPercent: z.coerce.number().min(1).max(100).default(100),
  /** How many times the offer can repeat inside one order. Null is as often as the basket allows. */
  maxApplications: z.coerce.number().int().min(1).max(1000).nullable().default(null),
});
export type RewardRules = z.infer<typeof rewardRulesSchema>;

export const CUSTOMER_SEGMENTS = ['all', 'new', 'returning', 'vip', 'groups', 'selected'] as const;
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];

/** The `customers.customer_type` values an owner can target as a group. */
export const CUSTOMER_GROUPS = ['new', 'repeat', 'vip', 'high_value'] as const;

/**
 * Who may have it. Every condition set here must hold at once.
 *
 * `new` means no previous order that was neither cancelled nor failed — the
 * same test as "first order only". The extras narrow it further, which is how
 * "first order, and joined in the last 30 days" is written.
 */
export const customerRulesSchema = z.object({
  segment: z.enum(CUSTOMER_SEGMENTS).default('all'),
  groups: z.array(z.enum(CUSTOMER_GROUPS)).max(4).default([]),
  minPreviousOrders: z.coerce.number().int().min(1).max(10_000).nullable().default(null),
  registeredWithinDays: z.coerce.number().int().min(1).max(3650).nullable().default(null),
  /** Has ordered before, but not in this many days. */
  inactiveDays: z.coerce.number().int().min(1).max(3650).nullable().default(null),
  /** Within this many days either side of the customer's birthday; 0 is the day itself. */
  birthdayWindowDays: z.coerce.number().int().min(0).max(31).nullable().default(null),
  /**
   * Counts the per-customer limit and the cooldown across every account that
   * shares this customer's email or phone number, rather than per account —
   * which is what stops a second sign-up taking a first-order offer twice.
   */
  limitByIdentity: z.boolean().default(false),
});
export type CustomerRules = z.infer<typeof customerRulesSchema>;

/**
 * How it must be paid for. Both halves must hold when both are set.
 *
 * `channels` is any-of. `bankIds` requires a card whose prefix one of those
 * banks lists — narrowed by `cardTypes` and, if given, by `cardPrefixes`.
 */
export const paymentRulesSchema = z.object({
  channels: z.array(z.enum(PAYMENT_CONDITIONS)).max(PAYMENT_CONDITIONS.length).default([]),
  bankIds: ids(100),
  cardTypes: z.array(z.enum(CARD_TYPES)).max(3).default([]),
  cardPrefixes: z
    .array(z.string().trim().regex(/^\d{6,8}$/, 'Use the first 6 to 8 digits of the card number.'))
    .max(200)
    .default([]),
});
export type PaymentRules = z.infer<typeof paymentRulesSchema>;

/** Where it is delivered to. Empty is everywhere; matched case-insensitively against the delivery address. */
export const areaRulesSchema = z.object({
  countries: z.array(z.string().trim().min(2).max(60)).max(50).default([]),
  cities: z.array(z.string().trim().min(2).max(80)).max(200).default([]),
});
export type AreaRules = z.infer<typeof areaRulesSchema>;

const clockTime = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 18:00.');

/**
 * Which days and hours it works, in the discount's own timezone.
 *
 * An end time before the start time crosses midnight — 22:00 to 02:00 is a
 * night sale, not an empty one.
 */
export const scheduleRulesSchema = z.object({
  /** 0 is Sunday. Empty is every day. */
  days: z.array(z.coerce.number().int().min(0).max(6)).max(7).default([]),
  startTime: clockTime.nullable().default(null),
  endTime: clockTime.nullable().default(null),
});
export type ScheduleRules = z.infer<typeof scheduleRulesSchema>;

/**
 * The groups a discount belongs to for stacking purposes.
 *
 * A discount can be in more than one: a coupon on a single category is both
 * `coupon` and `product`. Two
 * discounts combine only when **each** allows one of the other's groups.
 */
export const COMBINABLE_CLASSES = ['coupon', 'automatic', 'voucher', 'bank_offer', 'product'] as const;
export type CombinableClass = (typeof COMBINABLE_CLASSES)[number];

export const combinationRulesSchema = z.object({
  mode: z.enum(['none', 'selected', 'all']).default('none'),
  with: z.array(z.enum(COMBINABLE_CLASSES)).max(COMBINABLE_CLASSES.length).default([]),
});
export type CombinationRules = z.infer<typeof combinationRulesSchema>;

/**
 * When a voucher is handed out on its own.
 *
 * Two events a shop might want are deliberately absent. An abandoned basket
 * cannot be seen — the basket lives in the shopper's browser and the API has no
 * cart — and there is no referral programme to say who referred whom. A trigger
 * that can never fire is worse than none, because the shop believes it is
 * running.
 */
export const ISSUE_EVENTS = ['registration', 'first_order', 'order_count', 'total_spent', 'birthday', 'win_back'] as const;
export type IssueEvent = (typeof ISSUE_EVENTS)[number];

export const issueRulesSchema = z.object({
  event: z.enum(ISSUE_EVENTS),
  /** Orders for `order_count`, money for `total_spent`, days without an order for `win_back`. */
  threshold: z.coerce.number().min(1).max(100_000_000).nullable().default(null),
  /** How long an issued voucher lasts. Null lasts as long as the discount does. */
  validDays: z.coerce.number().int().min(1).max(3650).nullable().default(null),
});
export type IssueRules = z.infer<typeof issueRulesSchema>;

/** What happens when more than one automatic discount matches a basket. A store-wide choice. */
export const DISCOUNT_STRATEGIES = ['best', 'priority', 'stack'] as const;
export type DiscountStrategy = (typeof DISCOUNT_STRATEGIES)[number];
export const DEFAULT_DISCOUNT_STRATEGY: DiscountStrategy = 'best';

/** Parses a stored jsonb group, tolerating a row written before a key existed. */
export function readRules<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value ?? {});
  return parsed.success ? parsed.data : schema.parse({});
}

// ------------------------------------------------------------- write body --

const optionalMoney = moneySchema.nullable().default(null);
const optionalCount = (max: number) => z.coerce.number().int().min(1).max(max).nullable().default(null);

/** A wall-clock time in the discount's own timezone, as the editor's inputs hold it. */
const wallTime = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Pick a date and a time.')
  .nullable()
  .default(null);

export const DISCOUNT_CODE_PATTERN = /^[A-Z0-9-]+$/;

/**
 * The body the admin panel saves, whole.
 *
 * One schema for create and edit: every group is always sent, so an edit
 * cannot leave half of an old rule behind. The cross-field rules at the bottom
 * are the ones a single field cannot express, and each names the field it is
 * about so the editor can put the message beside it.
 */
export const discountInputSchema = z
  .object({
    kind: z.enum(DISCOUNT_KINDS),
    name: z.string().trim().min(2, 'Give the discount a name.').max(140),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .max(40)
      .nullable()
      .default(null)
      .transform((value) => (value ? value : null)),
    title: z.string().trim().max(200).nullable().default(null),
    summary: z.string().trim().max(400).nullable().default(null),
    notes: z.string().trim().max(1000).nullable().default(null),

    valueType: z.enum(DISCOUNT_VALUE_TYPES),
    value: moneySchema.default('0'),
    maxDiscountAmount: optionalMoney,

    minOrderAmount: optionalMoney,
    minQuantity: optionalCount(10_000),
    maxDiscountedQuantity: optionalCount(10_000),
    minSubtotalAfterDiscount: optionalMoney,

    productRules: productRulesSchema.default(productRulesSchema.parse({})),
    purchaseRules: purchaseRulesSchema.default(purchaseRulesSchema.parse({})),
    rewardRules: rewardRulesSchema.default(rewardRulesSchema.parse({})),
    customerRules: customerRulesSchema.default(customerRulesSchema.parse({})),
    /** The named customers: who a `selected` discount is for, and who holds a voucher. */
    customerIds: ids(5000),
    paymentRules: paymentRulesSchema.default(paymentRulesSchema.parse({})),
    areaRules: areaRulesSchema.default(areaRulesSchema.parse({})),

    usageLimit: optionalCount(10_000_000),
    perCustomerLimit: optionalCount(10_000),
    cooldownAmount: optionalCount(3650),
    cooldownUnit: z.enum(['day', 'week', 'month']).nullable().default(null),

    startsAt: wallTime,
    endsAt: wallTime,
    /** An IANA zone. Null follows the store's own timezone. */
    timezone: z.string().trim().max(64).nullable().default(null),
    scheduleRules: scheduleRulesSchema.default(scheduleRulesSchema.parse({})),

    combinationRules: combinationRulesSchema.default(combinationRulesSchema.parse({})),
    /** Lower goes first. */
    priority: z.coerce.number().int().min(1).max(1000).default(10),
    issueRules: issueRulesSchema.nullable().default(null),

    status: z.enum(DISCOUNT_STATUSES).default('active'),
  })
  .superRefine((body, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: path.split('.'), message });
    const value = Number.parseFloat(body.value);

    // --- the trigger ---------------------------------------------------------
    if (body.kind === 'coupon' && !body.code) issue('code', 'Enter the code customers will type.');
    if (body.code) {
      if (body.code.length < 3) issue('code', 'Use at least three characters.');
      else if (!DISCOUNT_CODE_PATTERN.test(body.code)) issue('code', 'Letters, numbers and dashes only.');
    }

    // --- the value -----------------------------------------------------------
    switch (body.valueType) {
      case 'percentage':
        if (!(value > 0 && value <= 100)) issue('value', 'Enter a percentage between 1 and 100.');
        break;
      case 'fixed_amount':
        if (!(value > 0)) issue('value', 'Enter the amount to take off.');
        break;
      case 'fixed_price':
        if (!(value >= 0)) issue('value', 'Enter the price each item sells for.');
        if (body.productRules.appliesTo !== 'specific') {
          issue('productRules.appliesTo', 'A fixed price needs the products it applies to.');
        }
        break;
      case 'bundle':
        if (!(value > 0)) issue('value', 'Enter what the whole bundle costs.');
        if (body.productRules.productIds.length < 2) {
          issue('productRules.productIds', 'Pick at least two products for the bundle.');
        }
        break;
      case 'buy_x_get_y':
        break;
    }

    // --- who and how -----------------------------------------------------------
    if (body.kind === 'bank_offer' && body.paymentRules.bankIds.length === 0) {
      issue('paymentRules.bankIds', 'Pick the banks whose cards get this offer.');
    }
    if (
      body.kind === 'payment_offer' &&
      body.paymentRules.channels.length === 0 &&
      body.paymentRules.bankIds.length === 0
    ) {
      issue('paymentRules.channels', 'Pick the payment methods that get this offer.');
    }
    if (body.customerRules.segment === 'groups' && body.customerRules.groups.length === 0) {
      issue('customerRules.groups', 'Pick at least one customer group.');
    }
    if (body.customerRules.segment === 'selected' && body.customerIds.length === 0) {
      issue('customerIds', 'Pick the customers this is for.');
    }
    if (body.kind === 'voucher' && body.customerIds.length === 0 && !body.issueRules) {
      issue('customerIds', 'Assign the voucher to a customer, or choose when it is issued.');
    }
    if (body.issueRules && body.kind !== 'voucher') {
      issue('issueRules', 'Only a voucher can be issued automatically.');
    }
    if (
      body.issueRules &&
      ['order_count', 'total_spent', 'win_back'].includes(body.issueRules.event) &&
      body.issueRules.threshold === null
    ) {
      issue('issueRules.threshold', 'Enter the number that triggers it.');
    }

    // --- limits ------------------------------------------------------------------
    if ((body.cooldownAmount === null) !== (body.cooldownUnit === null)) {
      issue('cooldownAmount', 'Enter how long, and in days, weeks or months.');
    }

    // --- time ----------------------------------------------------------------------
    if (body.startsAt && body.endsAt && body.endsAt <= body.startsAt) {
      issue('endsAt', 'The end has to come after the start.');
    }
    if ((body.scheduleRules.startTime === null) !== (body.scheduleRules.endTime === null)) {
      issue('scheduleRules.endTime', 'Enter both the start and the end of the time window.');
    }
    if (
      body.scheduleRules.startTime !== null &&
      body.scheduleRules.startTime === body.scheduleRules.endTime
    ) {
      issue('scheduleRules.endTime', 'The window has to end at a different time from when it starts.');
    }
    if (body.combinationRules.mode === 'selected' && body.combinationRules.with.length === 0) {
      issue('combinationRules.with', 'Pick what it can be combined with.');
    }
  })
  .transform((body) => ({
    ...body,
    // A code-less kind has no code, whatever the form sent.
    code: CODELESS_KINDS.includes(body.kind) ? null : body.code,
    // Buy X get Y carries no amount; storing one would print it somewhere.
    value: body.valueType === 'buy_x_get_y' ? '0.00' : body.value,
    scheduleRules: { ...body.scheduleRules, days: [...new Set(body.scheduleRules.days)].sort() },
    customerIds: [...new Set(body.customerIds)],
  }));

export type DiscountInput = z.infer<typeof discountInputSchema>;
