import { and, eq, isNull, sql } from 'drizzle-orm';
import { customers, discountCustomers, discounts, orders, storeSettings } from '../../db/schema/index';
import type { TenantExecutor } from '../../db/tenant-manager';
import { addInterval, isValidTimeZone, nearestBirthday } from '../../lib/discounts/zoned-time';
import { customerRulesSchema, readRules, type IssueEvent } from '../../lib/discounts/rules';
import { logger } from '../../lib/logger';
import { moneyToNumber } from '../../lib/utils';

/**
 * Vouchers that hand themselves out.
 *
 * A voucher with `issue_rules` is put into a customer's account when something
 * happens to them — they sign up, an order of theirs is delivered, their
 * birthday comes round, they have been away long enough. Each moment is a call
 * from the code that already witnesses it, never a sweep over every customer:
 *
 * - `registration` — from the three places an account is created;
 * - `first_order`, `order_count`, `total_spent` — from the order reaching
 *   `delivered`, which is when an order stops being a promise;
 * - `birthday`, `win_back` — from the customer's own next visit (their voucher
 *   list, their basket). Nothing is being sent to them, so issuing it when they
 *   arrive is exactly as useful as issuing it at midnight, and needs no job.
 *
 * Issuing is idempotent per `period_key`: an order-count voucher is issued once
 * ever, a birthday one once per birthday, a win-back one once per spell away.
 */
export type RewardMoment = 'registration' | 'order_delivered' | 'visit';

const EVENTS_FOR: Record<RewardMoment, IssueEvent[]> = {
  registration: ['registration'],
  order_delivered: ['first_order', 'order_count', 'total_spent'],
  visit: ['birthday', 'win_back'],
};

/** How close to a birthday a voucher is issued when the voucher names no window of its own. */
const DEFAULT_BIRTHDAY_WINDOW_DAYS = 7;

export async function issueRewards(db: TenantExecutor, customerId: string, moment: RewardMoment): Promise<number> {
  const events = EVENTS_FOR[moment];

  const vouchers = await db
    .select()
    .from(discounts)
    .where(
      and(
        eq(discounts.kind, 'voucher'),
        eq(discounts.status, 'active'),
        isNull(discounts.archivedAt),
        sql`${discounts.issueRules} is not null`,
        sql`${discounts.issueRules}->>'event' in (${sql.join(
          events.map((event) => sql`${event}`),
          sql`, `,
        )})`,
        sql`(${discounts.startsAt} is null or ${discounts.startsAt} <= now())`,
        sql`(${discounts.endsAt} is null or ${discounts.endsAt} > now())`,
      ),
    );

  if (vouchers.length === 0) return 0;

  const [customer] = await db
    .select({ id: customers.id, birthDate: customers.birthDate, status: customers.status })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  if (!customer || customer.status === 'blocked') return 0;

  const [history] = await db
    .select({
      delivered: sql<number>`count(*) filter (where ${orders.status} = 'delivered')::int`,
      spent: sql<string>`coalesce(sum(${orders.grandTotal} - ${orders.refundedTotal}) filter (where ${orders.status} = 'delivered'), 0)::text`,
      lastOrderAt: sql<Date | null>`max(${orders.placedAt}) filter (where ${orders.status} not in ('cancelled', 'failed'))`,
    })
    .from(orders)
    .where(eq(orders.customerId, customerId));

  const [settings] = await db.select({ timezone: storeSettings.timezone }).from(storeSettings).limit(1);
  const zone = settings?.timezone && isValidTimeZone(settings.timezone) ? settings.timezone : 'UTC';

  const now = new Date();
  const delivered = Number(history?.delivered ?? 0);
  const spent = moneyToNumber(history?.spent ?? '0');
  const lastOrderAt = history?.lastOrderAt ? new Date(history.lastOrderAt) : null;

  let issued = 0;

  for (const voucher of vouchers) {
    const rules = voucher.issueRules;
    if (!rules) continue;

    let periodKey: string | null = null;

    switch (rules.event) {
      case 'registration':
        periodKey = '';
        break;
      case 'first_order':
        if (delivered >= 1) periodKey = '';
        break;
      case 'order_count':
        if (rules.threshold !== null && delivered >= rules.threshold) periodKey = '';
        break;
      case 'total_spent':
        if (rules.threshold !== null && spent >= rules.threshold) periodKey = '';
        break;
      case 'birthday': {
        if (!customer.birthDate) break;
        const window =
          readRules(customerRulesSchema, voucher.customerRules).birthdayWindowDays ?? DEFAULT_BIRTHDAY_WINDOW_DAYS;
        const nearest = nearestBirthday(customer.birthDate, now, voucher.timezone ?? zone);
        if (nearest.days <= window) periodKey = String(nearest.year);
        break;
      }
      case 'win_back':
        // Away since their last order, which is also what names the spell: a
        // second win-back voucher needs a second order and a second absence.
        if (rules.threshold !== null && lastOrderAt && now.getTime() - lastOrderAt.getTime() >= rules.threshold * 86_400_000) {
          periodKey = lastOrderAt.toISOString().slice(0, 10);
        }
        break;
    }

    if (periodKey === null) continue;

    const expiresAt = rules.validDays !== null ? addInterval(now, rules.validDays, 'day') : voucher.endsAt;

    const inserted = await db
      .insert(discountCustomers)
      .values({
        discountId: voucher.id,
        customerId,
        source: 'reward',
        periodKey,
        expiresAt: voucher.endsAt && expiresAt && expiresAt > voucher.endsAt ? voucher.endsAt : expiresAt,
      })
      .onConflictDoNothing()
      .returning({ id: discountCustomers.id });

    issued += inserted.length;
  }

  return issued;
}

/**
 * The same, for a caller that must not fail because of it.
 *
 * Registration and delivery are the important acts; a voucher that could not be
 * issued is logged and the act goes ahead, which is the reasoning `audit()`
 * follows too.
 */
export async function issueRewardsQuietly(
  db: TenantExecutor,
  customerId: string | null | undefined,
  moment: RewardMoment,
): Promise<void> {
  if (!customerId) return;
  try {
    await issueRewards(db, customerId, moment);
  } catch (error) {
    logger.warn({ err: (error as Error).message, customerId, moment }, 'could not issue reward vouchers');
  }
}
