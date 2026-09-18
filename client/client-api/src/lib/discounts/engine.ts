import {
  CODE_REQUIRED_KINDS,
  type CardPrefix,
  type CombinableClass,
  type CombinationRules,
  type AreaRules,
  type CustomerRules,
  type DiscountKind,
  type DiscountStatus,
  type DiscountStrategy,
  type DiscountValueType,
  type PaymentChannelChoice,
  type PaymentCondition,
  type PaymentRules,
  type ProductRules,
  type PurchaseRules,
  type RewardRules,
  type ScheduleRules,
} from './rules';
import {
  addInterval,
  daysFromBirthday,
  formatClock,
  formatZonedDate,
  minutesOfDay,
  parseClock,
  zonedParts,
} from './zoned-time';

/**
 * What a basket is worth, and why.
 *
 * **The single authority.** The basket's preview, checkout's charge and the
 * refusal a shopper reads are all this function's answer to the same question,
 * so a figure shown in the basket and a different one charged at the till is not
 * something two copies of the rules can produce — there is one copy.
 *
 * It is pure: everything it needs about the customer, their history and the
 * catalogue is loaded by `modules/discounts/service.ts` and handed in, which is
 * what lets the arithmetic be read on its own and what keeps the database out of
 * the part that has to be exactly right.
 *
 * Money is **integer cents** from the moment it enters. A percentage off three
 * lines, capped, then shared back across those lines is four chances to lose a
 * cent to floating point, and a receipt whose lines do not add up to its total is
 * the one a customer photographs.
 */

// ------------------------------------------------------------------ inputs --

export interface EngineDiscount {
  id: string;
  kind: DiscountKind;
  code: string | null;
  name: string;
  title: string | null;
  summary: string | null;
  status: DiscountStatus;
  archived: boolean;
  valueType: DiscountValueType;
  /** A percentage for `percentage`; cents for every other type that has a value. */
  value: number;
  maxDiscountCents: number | null;
  minOrderCents: number | null;
  minQuantity: number | null;
  maxDiscountedQuantity: number | null;
  minSubtotalAfterCents: number | null;
  productRules: ProductRules;
  purchaseRules: PurchaseRules;
  rewardRules: RewardRules;
  customerRules: CustomerRules;
  paymentRules: PaymentRules;
  areaRules: AreaRules;
  scheduleRules: ScheduleRules;
  combinationRules: CombinationRules;
  usageLimit: number | null;
  usedCount: number;
  perCustomerLimit: number | null;
  cooldown: { amount: number; unit: 'day' | 'week' | 'month' } | null;
  startsAt: Date | null;
  endsAt: Date | null;
  /** Resolved: the discount's own zone, or the store's. */
  timezone: string;
  priority: number;
  createdAt: Date;
}

export interface EngineLine {
  /** Stable within one evaluation — the line's position in the basket. */
  key: string;
  productId: string;
  variantId: string;
  productName: string;
  /** The product's own category and every ancestor of it, so a parent category matches its subtree. */
  categoryIds: string[];
  brandId: string | null;
  collectionIds: string[];
  quantity: number;
  /** What one unit is charged, after any live sale. */
  unitCents: number;
  onSale: boolean;
  lineCents: number;
}

export interface EngineCustomer {
  id: string;
  createdAt: Date;
  birthDate: string | null;
  customerType: string;
  /** Orders that were neither cancelled nor failed, placed before this one. */
  previousOrders: number;
  lastOrderAt: Date | null;
}

/** A voucher held by the customer. */
export interface EngineHolding {
  id: string;
  expiresAt: Date | null;
  usedAt: Date | null;
}

/** How often this customer — or, with `limitByIdentity`, anybody sharing their email or phone — has used a discount. */
export interface EngineUsage {
  uses: number;
  lastUsedAt: Date | null;
}

export interface EngineBank {
  id: string;
  name: string;
  prefixes: CardPrefix[];
}

export interface EngineContext {
  now: Date;
  /** The store's timezone, for a discount that names none. */
  timezone: string;
  lines: EngineLine[];
  /** Null while there is no address — the basket. */
  address: { country: string | null; city: string | null } | null;
  customer: EngineCustomer | null;
  /** Discounts whose named-customer list includes this customer. */
  listedFor: Set<string>;
  holdings: Map<string, EngineHolding[]>;
  usage: Map<string, EngineUsage>;
  payment: { channel: PaymentChannelChoice | null; cardBin: string | null };
  /** Every active bank on file, so `credit_card` can be recognised from any of them. */
  banks: Map<string, EngineBank>;
  /** Product, category and brand names, for sentences that have to name what is missing. */
  names: Map<string, string>;
  money: (cents: number) => string;
  strategy: DiscountStrategy;
}

// ----------------------------------------------------------------- outputs --

export type RefusalReason =
  | 'unknown'
  | 'duplicate'
  | 'paused'
  | 'not_started'
  | 'expired'
  | 'usage_limit'
  | 'wrong_day'
  | 'wrong_time'
  | 'sign_in_required'
  | 'not_assigned'
  | 'voucher_used'
  | 'voucher_expired'
  | 'first_order_only'
  | 'returning_only'
  | 'vip_only'
  | 'not_eligible'
  | 'min_previous_orders'
  | 'new_accounts_only'
  | 'inactive_only'
  | 'birthday_missing'
  | 'birthday_window'
  | 'customer_limit'
  | 'cooldown'
  | 'required_items'
  | 'minimum_not_met'
  | 'minimum_quantity'
  | 'area'
  | 'payment_required'
  | 'payment_method'
  | 'card_required'
  | 'card_not_eligible'
  | 'nothing_eligible'
  | 'reward_missing'
  | 'bundle_incomplete'
  | 'minimum_after_discount'
  | 'not_combinable';

/**
 * Refusals that turn on something the shopper has not told us yet — how they
 * will pay, where it is going. The basket keeps such a code and says what it is
 * waiting for, rather than throwing away a code that will work at checkout.
 */
const RETAINABLE: ReadonlySet<RefusalReason> = new Set<RefusalReason>([
  'payment_required',
  'payment_method',
  'card_required',
  'card_not_eligible',
  'area',
]);

export interface AppliedDiscount {
  id: string;
  kind: DiscountKind;
  code: string | null;
  name: string;
  /** What the shopper reads: the owner's customer-facing title, or the offer itself. */
  label: string;
  summary: string | null;
  valueType: DiscountValueType;
  automatic: boolean;
  itemCents: number;
  totalCents: number;
  /** Cents taken off each line, keyed by `EngineLine.key`. Sums to `itemCents` exactly. */
  lineCents: Record<string, number>;
  /** The voucher holding this spends, if it is a voucher. */
  holdingId: string | null;
  message: string;
}

export interface RefusedDiscount {
  code: string | null;
  discountId: string | null;
  label: string | null;
  reason: RefusalReason;
  message: string;
  retainable: boolean;
}

export interface EngineQuote {
  applied: AppliedDiscount[];
  /** Codes the shopper entered that do not apply, each with the sentence that says why. */
  refused: RefusedDiscount[];
  /** Automatic offers that would apply once payment or the delivery address is known. */
  hints: RefusedDiscount[];
  itemCents: number;
  totalCents: number;
  lineCents: Record<string, number>;
}

export interface EngineInput {
  /** Codes in the order they were entered, each with the discount it names, if any. */
  entered: { code: string; discount: EngineDiscount | null }[];
  /** Every code-less discount switched on right now. */
  automatic: EngineDiscount[];
}

// ------------------------------------------------------------ vocabulary --

const PAYMENT_WORDS: Record<PaymentCondition, string> = {
  cod: 'cash on delivery',
  card: 'a card',
  credit_card: 'a credit card',
  debit_card: 'a debit card',
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  bkash: 'bKash',
  nagad: 'Nagad',
  rocket: 'Rocket',
  bank_transfer: 'bank transfer',
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function listWords(words: string[], joiner = 'or'): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} ${joiner} ${words[words.length - 1]}`;
}

/** What the offer is, in a few words — the label when the owner wrote no title. */
export function describeOffer(discount: EngineDiscount, money: (cents: number) => string): string {
  switch (discount.valueType) {
    case 'percentage':
      return `${trimNumber(discount.value)}% off`;
    case 'fixed_amount':
      return `${money(discount.value)} off`;
    case 'fixed_price':
      return `Special price ${money(discount.value)}`;
    case 'bundle':
      return `Bundle for ${money(discount.value)}`;
    case 'buy_x_get_y': {
      const reward = discount.rewardRules;
      const off = reward.getDiscountPercent >= 100 ? 'free' : `${trimNumber(reward.getDiscountPercent)}% off`;
      return `Buy ${reward.buyQuantity} get ${reward.getQuantity} ${off}`;
    }
  }
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function labelOf(discount: EngineDiscount, money: (cents: number) => string): string {
  return discount.title?.trim() || describeOffer(discount, money);
}

// --------------------------------------------------------------- matching --

function intersects(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(a);
  return b.some((value) => set.has(value));
}

function matchesTargets(
  line: EngineLine,
  targets: { productIds?: string[]; variantIds?: string[]; categoryIds?: string[]; brandIds?: string[]; collectionIds?: string[] },
): boolean {
  return (
    (targets.productIds?.includes(line.productId) ?? false) ||
    (targets.variantIds?.includes(line.variantId) ?? false) ||
    intersects(targets.categoryIds ?? [], line.categoryIds) ||
    (line.brandId !== null && (targets.brandIds?.includes(line.brandId) ?? false)) ||
    intersects(targets.collectionIds ?? [], line.collectionIds)
  );
}

function hasTargets(targets: { productIds?: string[]; categoryIds?: string[] }): boolean {
  return (targets.productIds?.length ?? 0) + (targets.categoryIds?.length ?? 0) > 0;
}

/** The classes a discount belongs to for stacking. See `COMBINABLE_CLASSES`. */
function classesOf(discount: EngineDiscount): CombinableClass[] {
  const classes: CombinableClass[] = [];
  if (discount.kind === 'coupon') classes.push('coupon');
  if (discount.kind === 'automatic' || discount.kind === 'campaign') classes.push('automatic');
  if (discount.kind === 'voucher') classes.push('voucher');
  if (discount.kind === 'bank_offer' || discount.kind === 'payment_offer') classes.push('bank_offer');
  if (
    discount.productRules.appliesTo === 'specific' ||
    discount.valueType === 'buy_x_get_y' ||
    discount.valueType === 'fixed_price' ||
    discount.valueType === 'bundle'
  ) {
    classes.push('product');
  }
  return classes;
}

function allows(owner: EngineDiscount, other: EngineDiscount): boolean {
  const rules = owner.combinationRules;
  if (rules.mode === 'all') return true;
  if (rules.mode === 'none') return false;
  return intersects(rules.with, classesOf(other));
}

/** Two discounts sit on one order only when each allows the other. */
export function combinable(a: EngineDiscount, b: EngineDiscount): boolean {
  return allows(a, b) && allows(b, a);
}

/** The network a card number belongs to, read off its first digits — a published standard, not a lookup. */
export function cardNetwork(bin: string): 'visa' | 'mastercard' | 'amex' | null {
  if (bin.startsWith('4')) return 'visa';
  const two = Number(bin.slice(0, 2));
  const four = Number(bin.slice(0, 4));
  if ((two >= 51 && two <= 55) || (four >= 2221 && four <= 2720)) return 'mastercard';
  if (two === 34 || two === 37) return 'amex';
  return null;
}

// ------------------------------------------------------------- eligibility --

interface Blocked {
  reason: RefusalReason;
  message: string;
}

const blocked = (reason: RefusalReason, message: string): Blocked => ({ reason, message });

function needsCustomer(discount: EngineDiscount): boolean {
  const rules = discount.customerRules;
  return (
    discount.kind === 'voucher' ||
    rules.segment !== 'all' ||
    rules.minPreviousOrders !== null ||
    rules.registeredWithinDays !== null ||
    rules.inactiveDays !== null ||
    rules.birthdayWindowDays !== null
  );
}

/**
 * Everything about a discount that does not depend on what else is on the
 * order, in the order a shopper can do something about it: what nobody can
 * change first (it has ended), then who they are, then what is in the basket,
 * then how they will pay — which is last because it is the one thing not yet
 * decided while the basket is being filled.
 */
function checkEligibility(discount: EngineDiscount, ctx: EngineContext): Blocked | null {
  const now = ctx.now;
  const zone = discount.timezone;
  const offer = discount.kind === 'voucher' ? 'voucher' : discount.kind === 'coupon' ? 'coupon' : 'offer';

  // --- the discount itself ------------------------------------------------------
  if (discount.status === 'paused') return blocked('paused', `This ${offer} is not available right now.`);
  if (discount.startsAt && discount.startsAt > now) {
    return blocked('not_started', `This ${offer} starts on ${formatZonedDate(discount.startsAt, zone, now)}.`);
  }
  if (discount.endsAt && discount.endsAt <= now) return blocked('expired', `This ${offer} has expired.`);
  if (discount.usageLimit !== null && discount.usedCount >= discount.usageLimit) {
    return blocked('usage_limit', `This ${offer} has been fully claimed.`);
  }

  const schedule = discount.scheduleRules;
  if (schedule.days.length > 0 || schedule.startTime) {
    const clock = zonedParts(now, zone);
    let weekday = clock.weekday;
    const minute = minutesOfDay(clock);

    if (schedule.startTime && schedule.endTime) {
      const start = parseClock(schedule.startTime);
      const end = parseClock(schedule.endTime);
      const overnight = end < start;
      const inside = overnight ? minute >= start || minute <= end : minute >= start && minute <= end;
      // The small hours of a night window belong to the evening that opened it,
      // so a Friday 22:00–02:00 sale is still Friday's at 01:00 on Saturday.
      if (overnight && minute <= end) weekday = (weekday + 6) % 7;

      if (schedule.days.length > 0 && !schedule.days.includes(weekday)) {
        return blocked('wrong_day', dayMessage(schedule.days));
      }
      if (!inside) {
        return blocked(
          'wrong_time',
          `This ${offer} is available between ${formatClock(schedule.startTime)} and ${formatClock(schedule.endTime)}.`,
        );
      }
    } else if (schedule.days.length > 0 && !schedule.days.includes(weekday)) {
      return blocked('wrong_day', dayMessage(schedule.days));
    }
  }

  // --- who is asking -----------------------------------------------------------------
  const customer = ctx.customer;
  if (needsCustomer(discount) && !customer) return blocked('sign_in_required', `Sign in to use this ${offer}.`);

  if (customer) {
    const rules = discount.customerRules;

    if (discount.kind === 'voucher') {
      const holdings = ctx.holdings.get(discount.id) ?? [];
      const usable = holdings.filter((holding) => !holding.usedAt && (!holding.expiresAt || holding.expiresAt > now));
      if (usable.length === 0) {
        if (holdings.length === 0) return blocked('not_assigned', 'This voucher is not in your account.');
        const expired = holdings.find((holding) => !holding.usedAt && holding.expiresAt && holding.expiresAt <= now);
        if (expired?.expiresAt) {
          return blocked('voucher_expired', `This voucher expired on ${formatZonedDate(expired.expiresAt, zone, now)}.`);
        }
        return blocked('voucher_used', 'This voucher has already been used.');
      }
    }

    switch (rules.segment) {
      case 'new':
        if (customer.previousOrders > 0) return blocked('first_order_only', `This ${offer} is available for first orders only.`);
        break;
      case 'returning':
        if (customer.previousOrders === 0) return blocked('returning_only', `This ${offer} is for returning customers.`);
        break;
      case 'vip':
        if (customer.customerType !== 'vip') return blocked('vip_only', `This ${offer} is for VIP customers.`);
        break;
      case 'groups':
        if (!rules.groups.includes(customer.customerType as never)) {
          return blocked('not_eligible', `This ${offer} is not available for your account.`);
        }
        break;
      case 'selected':
        if (!ctx.listedFor.has(discount.id)) return blocked('not_eligible', `This ${offer} is not available for your account.`);
        break;
      case 'all':
        break;
    }

    if (rules.minPreviousOrders !== null && customer.previousOrders < rules.minPreviousOrders) {
      const more = rules.minPreviousOrders - customer.previousOrders;
      return blocked(
        'min_previous_orders',
        `This ${offer} unlocks after ${rules.minPreviousOrders} ${plural(rules.minPreviousOrders, 'order')} — ${more} to go.`,
      );
    }
    if (
      rules.registeredWithinDays !== null &&
      now.getTime() - customer.createdAt.getTime() > rules.registeredWithinDays * 86_400_000
    ) {
      return blocked(
        'new_accounts_only',
        `This ${offer} is for customers who joined in the last ${rules.registeredWithinDays} ${plural(rules.registeredWithinDays, 'day')}.`,
      );
    }
    if (rules.inactiveDays !== null) {
      const quietSince = now.getTime() - rules.inactiveDays * 86_400_000;
      if (!customer.lastOrderAt || customer.lastOrderAt.getTime() > quietSince) {
        return blocked(
          'inactive_only',
          `This ${offer} is for customers who have not ordered in ${rules.inactiveDays} ${plural(rules.inactiveDays, 'day')}.`,
        );
      }
    }
    if (rules.birthdayWindowDays !== null) {
      if (!customer.birthDate) {
        return blocked('birthday_missing', `Add your birthday to your account to use this ${offer}.`);
      }
      if (daysFromBirthday(customer.birthDate, now, zone) > rules.birthdayWindowDays) {
        return blocked(
          'birthday_window',
          rules.birthdayWindowDays === 0
            ? `This ${offer} is available on your birthday.`
            : `This ${offer} is available within ${rules.birthdayWindowDays} ${plural(rules.birthdayWindowDays, 'day')} of your birthday.`,
        );
      }
    }

    const usage = ctx.usage.get(discount.id);
    if (discount.perCustomerLimit !== null && usage && usage.uses >= discount.perCustomerLimit) {
      return blocked(
        'customer_limit',
        discount.perCustomerLimit === 1
          ? `You have already used this ${offer}.`
          : `You have already used this ${offer} ${discount.perCustomerLimit} times.`,
      );
    }
    if (discount.cooldown && usage?.lastUsedAt) {
      const next = addInterval(usage.lastUsedAt, discount.cooldown.amount, discount.cooldown.unit);
      if (next > now) {
        return blocked('cooldown', `This ${offer} can be used again after ${formatZonedDate(next, zone, now)}.`);
      }
    }
  }

  // --- what is in the basket ----------------------------------------------------------
  const purchase = discount.purchaseRules;
  const lines = ctx.lines;
  const missing: string[] = [];
  if (purchase.requiredProductIds.length > 0 && !lines.some((line) => purchase.requiredProductIds.includes(line.productId))) {
    missing.push(nameList(purchase.requiredProductIds, ctx));
  }
  if (purchase.requiredCategoryIds.length > 0 && !lines.some((line) => intersects(purchase.requiredCategoryIds, line.categoryIds))) {
    missing.push(`something from ${nameList(purchase.requiredCategoryIds, ctx)}`);
  }
  if (
    purchase.requiredBrandIds.length > 0 &&
    !lines.some((line) => line.brandId !== null && purchase.requiredBrandIds.includes(line.brandId))
  ) {
    missing.push(`something from ${nameList(purchase.requiredBrandIds, ctx)}`);
  }
  if (missing.length > 0) {
    return blocked('required_items', `Add ${listWords(missing, 'and')} to your basket to use this ${offer}.`);
  }

  const subtotal = lines.reduce((sum, line) => sum + line.lineCents, 0);
  if (discount.minOrderCents !== null && subtotal < discount.minOrderCents) {
    return blocked('minimum_not_met', `Minimum order amount is ${ctx.money(discount.minOrderCents)}.`);
  }

  // --- where it is going -----------------------------------------------------------------
  const area = discount.areaRules;
  if (area.countries.length > 0 || area.cities.length > 0) {
    const places = [...area.cities, ...area.countries];
    if (!ctx.address) {
      return blocked('area', `This ${offer} is for deliveries to ${listWords(places)}. We will check your address at checkout.`);
    }
    const city = ctx.address.city?.trim().toLowerCase() ?? '';
    const country = ctx.address.country?.trim().toLowerCase() ?? '';
    const inCity = area.cities.some((entry) => entry.toLowerCase() === city);
    const inCountry = area.countries.some((entry) => entry.toLowerCase() === country);
    if (!inCity && !inCountry) {
      return blocked('area', `This ${offer} is only available for deliveries to ${listWords(places)}.`);
    }
  }

  // --- how it is paid for --------------------------------------------------------------------
  return checkPayment(discount, ctx, offer);
}

function checkPayment(discount: EngineDiscount, ctx: EngineContext, offer: string): Blocked | null {
  const rules = discount.paymentRules;
  if (rules.channels.length === 0 && rules.bankIds.length === 0 && rules.cardPrefixes.length === 0) return null;

  const { channel, cardBin } = ctx.payment;
  const bankNames = rules.bankIds.map((id) => ctx.banks.get(id)?.name).filter((name): name is string => Boolean(name));
  const cardWord = rules.cardTypes.length === 1 ? `${rules.cardTypes[0]} ` : '';
  const describe = () =>
    bankNames.length > 0
      ? `an eligible ${listWords(bankNames)} ${cardWord}card`
      : listWords(rules.channels.map((entry) => PAYMENT_WORDS[entry]));

  if (!channel) return blocked('payment_required', `This ${offer} applies when you pay with ${describe()}.`);

  if (rules.channels.length > 0) {
    let needsNumber = false;
    const satisfied = rules.channels.some((condition) => {
      const verdict = channelSatisfies(condition, channel, cardBin, ctx);
      if (verdict === 'need_bin') needsNumber = true;
      return verdict === true;
    });
    if (!satisfied) {
      if (needsNumber) return blocked('card_required', `Enter the first 6 digits of your card to use this ${offer}.`);
      return blocked(
        'payment_method',
        `This ${offer} is only available when paying with ${listWords(rules.channels.map((entry) => PAYMENT_WORDS[entry]))}.`,
      );
    }
  }

  if (rules.bankIds.length > 0 || rules.cardPrefixes.length > 0) {
    if (channel !== 'card') {
      return blocked('payment_method', `This ${offer} is available only with ${describe()}.`);
    }
    if (!cardBin) {
      return blocked(
        'card_required',
        bankNames.length > 0
          ? `Enter the first 6 digits of your ${listWords(bankNames)} card to use this ${offer}.`
          : `Enter the first 6 digits of your card to use this ${offer}.`,
      );
    }

    if (rules.bankIds.length > 0) {
      const matched = rules.bankIds.some((id) =>
        (ctx.banks.get(id)?.prefixes ?? []).some(
          (entry) =>
            cardBin.startsWith(entry.prefix) &&
            (rules.cardTypes.length === 0 || (entry.cardType !== null && rules.cardTypes.includes(entry.cardType))),
        ),
      );
      if (!matched) {
        return blocked(
          'card_not_eligible',
          `This ${offer} is available only with eligible ${listWords(bankNames)} ${cardWord}cards.`,
        );
      }
    }
    if (rules.cardPrefixes.length > 0 && !rules.cardPrefixes.some((prefix) => cardBin.startsWith(prefix))) {
      return blocked('card_not_eligible', `This card is not eligible for this ${offer}.`);
    }
  }

  return null;
}

function channelSatisfies(
  condition: PaymentCondition,
  channel: PaymentChannelChoice,
  bin: string | null,
  ctx: EngineContext,
): boolean | 'need_bin' {
  switch (condition) {
    case 'cod':
    case 'bkash':
    case 'nagad':
    case 'rocket':
    case 'bank_transfer':
    case 'card':
      return channel === condition;
    case 'visa':
    case 'mastercard':
    case 'amex':
      if (channel !== 'card') return false;
      return bin ? cardNetwork(bin) === condition : 'need_bin';
    case 'credit_card':
    case 'debit_card': {
      if (channel !== 'card') return false;
      if (!bin) return 'need_bin';
      const wanted = condition === 'credit_card' ? 'credit' : 'debit';
      return [...ctx.banks.values()].some((bank) =>
        bank.prefixes.some((entry) => entry.cardType === wanted && bin.startsWith(entry.prefix)),
      );
    }
  }
}

function dayMessage(days: number[]): string {
  const names = [...days].sort().map((day) => DAY_NAMES[day]!);
  return `This offer is only available on ${listWords(names, 'and')}.`;
}

function nameList(ids: string[], ctx: EngineContext): string {
  const names = ids.map((id) => ctx.names.get(id)).filter((name): name is string => Boolean(name));
  if (names.length === 0) return 'an eligible item';
  if (names.length > 3) return `${names.slice(0, 3).join(', ')} or another eligible item`;
  return listWords(names);
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

// ------------------------------------------------------------- arithmetic --

/** What is left to discount on each line, and what earlier discounts have touched. */
interface State {
  remaining: Map<string, number>;
  touched: Set<string>;
  itemApplied: number;
}

function cloneState(state: State): State {
  return {
    remaining: new Map(state.remaining),
    touched: new Set(state.touched),
    itemApplied: state.itemApplied,
  };
}

interface Unit {
  key: string;
  cents: number;
}

/** A line as individual units, each carrying its share of what is left on the line. */
function unitsOf(lines: EngineLine[], state: State): Unit[] {
  const units: Unit[] = [];
  for (const line of lines) {
    const left = state.remaining.get(line.key) ?? 0;
    if (left <= 0) continue;
    const each = left / line.quantity;
    for (let index = 0; index < line.quantity; index += 1) units.push({ key: line.key, cents: each });
  }
  return units;
}

type Computed =
  | { ok: true; perLine: Map<string, number> }
  | { ok: false; blocked: Blocked };

function computeAmount(discount: EngineDiscount, ctx: EngineContext, state: State): Computed {
  const rules = discount.productRules;

  // Lines the discount may touch at all: exclusions always win.
  const open = ctx.lines.filter(
    (line) =>
      (state.remaining.get(line.key) ?? 0) > 0 &&
      !rules.excludeProductIds.includes(line.productId) &&
      !intersects(rules.excludeCategoryIds, line.categoryIds) &&
      !(line.brandId !== null && rules.excludeBrandIds.includes(line.brandId)) &&
      !(rules.excludeSaleItems && line.onSale) &&
      !(rules.excludeDiscountedItems && state.touched.has(line.key)),
  );
  const scoped = rules.appliesTo === 'specific' ? open.filter((line) => matchesTargets(line, rules)) : open;

  const perLine = new Map<string, number>();
  const add = (key: string, cents: number) => perLine.set(key, (perLine.get(key) ?? 0) + cents);
  const nothing = blocked('nothing_eligible', 'Nothing in your basket qualifies for this offer.');

  const capUnits = (units: Unit[]) =>
    discount.maxDiscountedQuantity !== null
      ? [...units].sort((a, b) => a.cents - b.cents).slice(0, discount.maxDiscountedQuantity)
      : units;

  const quantityOf = (lines: EngineLine[]) => lines.reduce((sum, line) => sum + line.quantity, 0);
  const checkMinimumQuantity = (lines: EngineLine[]): Blocked | null => {
    if (discount.minQuantity === null) return null;
    const have = quantityOf(lines);
    return have >= discount.minQuantity
      ? null
      : blocked(
          'minimum_quantity',
          `Add ${discount.minQuantity - have} more eligible ${plural(discount.minQuantity - have, 'item')} to use this offer.`,
        );
  };

  switch (discount.valueType) {
    case 'percentage':
    case 'fixed_amount':
    case 'fixed_price': {
      if (scoped.length === 0) return { ok: false, blocked: nothing };
      const short = checkMinimumQuantity(scoped);
      if (short) return { ok: false, blocked: short };

      const units = capUnits(unitsOf(scoped, state));
      if (discount.valueType === 'percentage') {
        for (const unit of units) add(unit.key, (unit.cents * discount.value) / 100);
      } else if (discount.valueType === 'fixed_price') {
        for (const unit of units) add(unit.key, Math.max(0, unit.cents - discount.value));
      } else {
        const pool = units.reduce((sum, unit) => sum + unit.cents, 0);
        const amount = Math.min(discount.value, pool);
        if (pool > 0) for (const unit of units) add(unit.key, (unit.cents / pool) * amount);
      }
      return { ok: true, perLine };
    }

    case 'buy_x_get_y': {
      const reward = discount.rewardRules;
      const buyTargets = { productIds: reward.buyProductIds, categoryIds: reward.buyCategoryIds };
      const getTargets = { productIds: reward.getProductIds, categoryIds: reward.getCategoryIds };
      const buyPool = hasTargets(buyTargets) ? open.filter((line) => matchesTargets(line, buyTargets)) : scoped;
      const short = checkMinimumQuantity(buyPool);
      if (short) return { ok: false, blocked: short };

      const percent = reward.getDiscountPercent;
      const cap = (count: number) => (reward.maxApplications === null ? count : Math.min(count, reward.maxApplications));

      if (!hasTargets(getTargets)) {
        // One pool: every group of buy + get units, most expensive first, gives
        // its cheapest `get` units the reward — the ordinary Buy 2 Get 1 Free.
        const units = unitsOf(buyPool, state).sort((a, b) => b.cents - a.cents);
        const group = reward.buyQuantity + reward.getQuantity;
        const applications = cap(Math.floor(units.length / group));
        if (applications === 0) {
          const have = units.length;
          return {
            ok: false,
            blocked:
              have < reward.buyQuantity
                ? blocked('minimum_quantity', `Add ${reward.buyQuantity - have} more eligible ${plural(reward.buyQuantity - have, 'item')} to unlock this offer.`)
                : blocked('reward_missing', `Add ${group - have} more eligible ${plural(group - have, 'item')} to get ${reward.getQuantity === 1 ? 'it' : 'them'} ${percent >= 100 ? 'free' : `at ${trimNumber(percent)}% off`}.`),
          };
        }
        for (let index = 0; index < applications; index += 1) {
          for (let offset = reward.buyQuantity; offset < group; offset += 1) {
            const unit = units[index * group + offset]!;
            add(unit.key, (unit.cents * percent) / 100);
          }
        }
        return { ok: true, perLine };
      }

      const buyUnits = unitsOf(buyPool, state);
      const applications = cap(Math.floor(buyUnits.length / reward.buyQuantity));
      if (applications === 0) {
        const more = reward.buyQuantity - buyUnits.length;
        return {
          ok: false,
          blocked: blocked('minimum_quantity', `Add ${more} more eligible ${plural(more, 'item')} to unlock this offer.`),
        };
      }

      const buyKeys = new Set(buyPool.map((line) => line.key));
      const getPool = open.filter((line) => !buyKeys.has(line.key) && matchesTargets(line, getTargets));
      const rewarded = unitsOf(getPool, state)
        .sort((a, b) => a.cents - b.cents)
        .slice(0, applications * reward.getQuantity);
      if (rewarded.length === 0) {
        const names = nameList([...reward.getProductIds, ...reward.getCategoryIds], ctx);
        return {
          ok: false,
          blocked: blocked('reward_missing', `Add ${names} to your basket to get it ${percent >= 100 ? 'free' : `at ${trimNumber(percent)}% off`}.`),
        };
      }
      for (const unit of rewarded) add(unit.key, (unit.cents * percent) / 100);
      return { ok: true, perLine };
    }

    case 'bundle': {
      const members = rules.productIds;
      const shelves = members.map((productId) =>
        unitsOf(open.filter((line) => line.productId === productId), state).sort((a, b) => a.cents - b.cents),
      );
      const complete = Math.min(...shelves.map((units) => units.length));
      const sets =
        discount.rewardRules.maxApplications === null ? complete : Math.min(complete, discount.rewardRules.maxApplications);
      if (sets === 0 || members.length === 0) {
        return {
          ok: false,
          blocked: blocked('bundle_incomplete', `Add every product in the bundle to your basket: ${listWords(members.map((id) => ctx.names.get(id) ?? 'an item'), 'and')}.`),
        };
      }
      for (let index = 0; index < sets; index += 1) {
        const set = shelves.map((units) => units[index]!);
        const regular = set.reduce((sum, unit) => sum + unit.cents, 0);
        const saving = Math.max(0, regular - discount.value);
        if (regular > 0) for (const unit of set) add(unit.key, (unit.cents / regular) * saving);
      }
      return { ok: true, perLine };
    }
  }
}

/**
 * Turns fractional cents per line into whole cents that add up exactly.
 *
 * Largest remainder: the total is rounded once, each line takes its floor, and
 * the cents that rounding left over go to the lines that lost the most. Rounding
 * each line on its own would let three lines of 33.5 cents become a discount of
 * 102 cents printed beside a total of 100.
 */
function wholeCents(perLine: Map<string, number>, state: State): Map<string, number> {
  const entries = [...perLine.entries()].map(([key, value]) => ({
    key,
    value: Math.max(0, Math.min(value, state.remaining.get(key) ?? 0)),
  }));
  const target = Math.round(entries.reduce((sum, entry) => sum + entry.value, 0));
  const floors = entries.map((entry) => ({ ...entry, whole: Math.floor(entry.value), rest: entry.value - Math.floor(entry.value) }));
  let left = target - floors.reduce((sum, entry) => sum + entry.whole, 0);

  for (const entry of [...floors].sort((a, b) => b.rest - a.rest)) {
    if (left <= 0) break;
    if (entry.whole < (state.remaining.get(entry.key) ?? 0)) {
      entry.whole += 1;
      left -= 1;
    }
  }

  return new Map(floors.filter((entry) => entry.whole > 0).map((entry) => [entry.key, entry.whole]));
}

type Outcome = { ok: true; applied: AppliedDiscount } | { ok: false; blocked: Blocked };

function price(discount: EngineDiscount, ctx: EngineContext, state: State, automatic: boolean): Outcome {
  const computed = computeAmount(discount, ctx, state);
  if (!computed.ok) return computed;

  let { perLine } = computed;
  const raw = [...perLine.values()].reduce((sum, value) => sum + value, 0);

  // The ceiling covers the whole of what this discount gives.
  if (discount.maxDiscountCents !== null && raw > discount.maxDiscountCents && raw > 0) {
    const scale = discount.maxDiscountCents / raw;
    perLine = new Map([...perLine.entries()].map(([key, value]) => [key, value * scale]));
  }

  const lines = wholeCents(perLine, state);
  const itemCents = [...lines.values()].reduce((sum, value) => sum + value, 0);

  if (itemCents === 0) {
    return { ok: false, blocked: blocked('nothing_eligible', 'Nothing in your basket qualifies for this offer.') };
  }

  if (discount.minSubtotalAfterCents !== null) {
    const subtotal = ctx.lines.reduce((sum, line) => sum + line.lineCents, 0);
    if (subtotal - state.itemApplied - itemCents < discount.minSubtotalAfterCents) {
      return {
        ok: false,
        blocked: blocked(
          'minimum_after_discount',
          `Your order has to stay above ${ctx.money(discount.minSubtotalAfterCents)} after discounts to use this offer.`,
        ),
      };
    }
  }

  const label = labelOf(discount, ctx.money);
  const totalCents = itemCents;
  const holdings = (ctx.holdings.get(discount.id) ?? [])
    .filter((holding) => !holding.usedAt && (!holding.expiresAt || holding.expiresAt > ctx.now))
    .sort((a, b) => (a.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER));

  const message = automatic
    ? `${ctx.money(totalCents)} discount automatically applied.`
    : `${discount.code} applied — ${ctx.money(totalCents)} off.`;

  return {
    ok: true,
    applied: {
      id: discount.id,
      kind: discount.kind,
      code: discount.code,
      name: discount.name,
      label,
      summary: discount.summary,
      valueType: discount.valueType,
      automatic,
      itemCents,
      totalCents,
      lineCents: Object.fromEntries(lines),
      holdingId: discount.kind === 'voucher' ? (holdings[0]?.id ?? null) : null,
      message,
    },
  };
}

function commit(state: State, applied: AppliedDiscount): void {
  for (const [key, cents] of Object.entries(applied.lineCents)) {
    state.remaining.set(key, (state.remaining.get(key) ?? 0) - cents);
    state.touched.add(key);
  }
  state.itemApplied += applied.itemCents;
}

// ------------------------------------------------------------------ the run --

/**
 * Works out every discount on one basket.
 *
 * **Codes first, in the order they were typed**, because they are the shopper's
 * explicit choice: one that does not apply is refused with its reason, and one
 * that cannot sit beside a code already accepted is refused rather than
 * silently replacing it. **Automatic discounts after**, which are the store's
 * choice, fitted around whatever the shopper chose by the store-wide strategy:
 *
 * - `best` — the single automatic discount worth the most on this basket;
 * - `priority` — the single one with the lowest priority number that applies;
 * - `stack` — every one that applies and combines, in priority order.
 *
 * Each discount is priced on what the ones before it left, so two 50% discounts
 * take 75% off rather than 100%, and nothing is ever discounted below zero.
 */
export function evaluateDiscounts(ctx: EngineContext, input: EngineInput): EngineQuote {
  const state: State = {
    remaining: new Map(ctx.lines.map((line) => [line.key, line.lineCents])),
    touched: new Set(),
    itemApplied: 0,
  };

  const applied: { discount: EngineDiscount; result: AppliedDiscount }[] = [];
  const refused: RefusedDiscount[] = [];
  const hints: RefusedDiscount[] = [];
  const seen = new Set<string>();

  const refuse = (code: string, discount: EngineDiscount | null, why: Blocked) =>
    refused.push({
      code,
      discountId: discount?.id ?? null,
      label: discount ? labelOf(discount, ctx.money) : null,
      reason: why.reason,
      message: why.message,
      retainable: RETAINABLE.has(why.reason),
    });

  for (const { code, discount } of input.entered) {
    // A draft or deleted discount answers exactly like a code that never existed.
    if (!discount || discount.archived || discount.status === 'draft' || !discount.code) {
      refuse(code, null, blocked('unknown', 'That code is not valid.'));
      continue;
    }
    if (seen.has(discount.id)) {
      refuse(code, discount, blocked('duplicate', 'That code is already applied.'));
      continue;
    }
    seen.add(discount.id);

    const why = checkEligibility(discount, ctx);
    if (why) {
      refuse(code, discount, why);
      continue;
    }

    const clash = applied.find((entry) => !combinable(discount, entry.discount));
    if (clash) {
      const other = clash.discount.code ?? labelOf(clash.discount, ctx.money);
      refuse(code, discount, blocked('not_combinable', `${discount.code} cannot be combined with ${other}.`));
      continue;
    }

    const outcome = price(discount, ctx, state, false);
    if (!outcome.ok) {
      refuse(code, discount, outcome.blocked);
      continue;
    }
    commit(state, outcome.applied);
    applied.push({ discount, result: outcome.applied });
  }

  const candidates = input.automatic
    .filter((discount) => !seen.has(discount.id) && discount.status === 'active' && !discount.archived)
    .filter((discount) => !CODE_REQUIRED_KINDS.includes(discount.kind) && !discount.code)
    .filter((discount) => {
      const why = checkEligibility(discount, ctx);
      if (why && RETAINABLE.has(why.reason)) {
        hints.push({
          code: null,
          discountId: discount.id,
          label: labelOf(discount, ctx.money),
          reason: why.reason,
          message: why.message,
          retainable: true,
        });
      }
      return !why;
    })
    .filter((discount) => applied.every((entry) => combinable(discount, entry.discount)))
    .sort((a, b) => a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime());

  const accept = (discount: EngineDiscount): boolean => {
    if (!applied.every((entry) => combinable(discount, entry.discount))) return false;
    const outcome = price(discount, ctx, state, true);
    if (!outcome.ok) return false;
    commit(state, outcome.applied);
    applied.push({ discount, result: outcome.applied });
    return true;
  };

  if (ctx.strategy === 'stack') {
    for (const discount of candidates) accept(discount);
  } else if (ctx.strategy === 'priority') {
    for (const discount of candidates) if (accept(discount)) break;
  } else {
    let best: { discount: EngineDiscount; total: number } | null = null;
    for (const discount of candidates) {
      const outcome = price(discount, ctx, cloneState(state), true);
      if (!outcome.ok) continue;
      const total = outcome.applied.totalCents;
      if (!best || total > best.total) best = { discount, total };
    }
    if (best) accept(best.discount);
  }

  const lineCents: Record<string, number> = {};
  for (const { result } of applied) {
    for (const [key, cents] of Object.entries(result.lineCents)) lineCents[key] = (lineCents[key] ?? 0) + cents;
  }

  const itemCents = applied.reduce((sum, entry) => sum + entry.result.itemCents, 0);

  return {
    applied: applied.map((entry) => entry.result),
    refused,
    hints: hints.filter((hint) => !applied.some((entry) => entry.discount.id === hint.discountId)),
    itemCents,
    totalCents: itemCents,
    lineCents,
  };
}
