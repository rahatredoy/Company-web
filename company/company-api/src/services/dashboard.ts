import { and, count, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  clientAccounts,
  clientBusinessProfiles,
  payments,
  plans,
  subscriptions,
  tenants,
  trials,
} from '../db/schema/index';
import { config } from '../config/index';
import { addDays, addMonths, pctChange, startOfDay } from '../lib/utils';
import { storeAdminLogin } from './views';

export type RangeKey = '7d' | '30d' | '3m' | '6m' | '1y' | 'custom';

export interface RangeWindow {
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
  /** Granularity used for the time series. */
  bucket: 'day' | 'week' | 'month';
}

export function resolveRange(key: RangeKey, customFrom?: string, customTo?: string): RangeWindow {
  const to = customTo ? new Date(customTo) : new Date();
  let from: Date;
  let bucket: RangeWindow['bucket'] = 'day';

  switch (key) {
    case '7d':
      from = addDays(to, -7);
      break;
    case '3m':
      from = addMonths(to, -3);
      bucket = 'week';
      break;
    case '6m':
      from = addMonths(to, -6);
      bucket = 'week';
      break;
    case '1y':
      from = addMonths(to, -12);
      bucket = 'month';
      break;
    case 'custom':
      from = customFrom ? new Date(customFrom) : addDays(to, -30);
      break;
    case '30d':
    default:
      from = addDays(to, -30);
      break;
  }

  const span = to.getTime() - from.getTime();
  return {
    from: startOfDay(from),
    to,
    previousFrom: new Date(from.getTime() - span),
    previousTo: from,
    bucket,
  };
}

export interface MetricDelta {
  value: number;
  changePct: number | null;
  spark: number[];
}

function metric(value: number, previous: number, spark: number[] = []): MetricDelta {
  return { value, changePct: pctChange(value, previous), spark };
}

/** Cumulative daily counts, used for the KPI sparklines. */
async function cumulativeSeries(window: RangeWindow, table: 'clients' | 'tenants'): Promise<number[]> {
  const rows =
    table === 'clients'
      ? await db.execute(sql`
          select date_trunc('day', created_at)::date as day, count(*)::int as total
          from client_accounts
          where created_at >= ${window.from} and created_at <= ${window.to}
          group by 1 order by 1
        `)
      : await db.execute(sql`
          select date_trunc('day', created_at)::date as day, count(*)::int as total
          from tenants
          where created_at >= ${window.from} and created_at <= ${window.to}
          group by 1 order by 1
        `);

  let running = 0;
  return (rows.rows as { total: number }[]).map((row) => {
    running += Number(row.total);
    return running;
  });
}

async function revenueSeries(window: RangeWindow): Promise<number[]> {
  const rows = await db.execute(sql`
    select date_trunc('day', paid_at)::date as day, coalesce(sum(amount), 0)::float as total
    from payments
    where status = 'paid' and paid_at >= ${window.from} and paid_at <= ${window.to}
    group by 1 order by 1
  `);
  return (rows.rows as { total: number }[]).map((row) => Number(row.total));
}

async function countIn(table: 'clients', from: Date, to: Date): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(clientAccounts)
    .where(and(gte(clientAccounts.createdAt, from), lte(clientAccounts.createdAt, to)));
  void table;
  return Number(rows[0]?.total ?? 0);
}

async function countSubscriptionStatus(status: string): Promise<number> {
  const rows = await db.execute(sql`
    select count(*)::int as total from subscriptions where status = ${status}
  `);
  return Number((rows.rows[0] as { total: number } | undefined)?.total ?? 0);
}

/** Monthly recurring revenue: yearly plans are normalised to a monthly figure. */
async function monthlyRecurringRevenue(): Promise<number> {
  const rows = await db.execute(sql`
    select coalesce(sum(case when billing_cycle = 'yearly' then price / 12 else price end), 0)::float as mrr
    from subscriptions
    where status in ('active', 'past_due')
  `);
  return Number((rows.rows[0] as { mrr: number } | undefined)?.mrr ?? 0);
}

async function paymentsSum(from: Date, to: Date): Promise<number> {
  const rows = await db.execute(sql`
    select coalesce(sum(amount), 0)::float as total
    from payments
    where status = 'paid' and paid_at >= ${from} and paid_at <= ${to}
  `);
  return Number((rows.rows[0] as { total: number } | undefined)?.total ?? 0);
}

async function failedPaymentsCount(from: Date, to: Date): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(payments)
    .where(and(eq(payments.status, 'failed'), gte(payments.createdAt, from), lte(payments.createdAt, to)));
  return Number(rows[0]?.total ?? 0);
}

export async function buildDashboard(window: RangeWindow) {
  const [
    totalClients,
    previousTotalClients,
    activeSubs,
    trialSubs,
    pastDueSubs,
    expiredSubs,
    cancelledSubs,
    suspendedSubs,
    mrr,
    paymentsThisWindow,
    paymentsPreviousWindow,
    failedNow,
    failedPrevious,
    clientSpark,
    revenueSpark,
  ] = await Promise.all([
    db.select({ total: count() }).from(clientAccounts).then((r) => Number(r[0]?.total ?? 0)),
    countIn('clients', window.previousFrom, window.previousTo),
    countSubscriptionStatus('active'),
    countSubscriptionStatus('trial'),
    countSubscriptionStatus('past_due'),
    countSubscriptionStatus('expired'),
    countSubscriptionStatus('cancelled'),
    countSubscriptionStatus('suspended'),
    monthlyRecurringRevenue(),
    paymentsSum(window.from, window.to),
    paymentsSum(window.previousFrom, window.previousTo),
    failedPaymentsCount(window.from, window.to),
    failedPaymentsCount(window.previousFrom, window.previousTo),
    cumulativeSeries(window, 'clients'),
    revenueSeries(window),
  ]);

  const newClientsThisWindow = await countIn('clients', window.from, window.to);

  const [trialTotals, trialConverted] = await Promise.all([
    db.select({ total: count() }).from(trials).then((r) => Number(r[0]?.total ?? 0)),
    db
      .select({ total: count() })
      .from(trials)
      .where(eq(trials.status, 'converted'))
      .then((r) => Number(r[0]?.total ?? 0)),
  ]);

  const conversionRows = await db.execute(sql`
    select date_trunc('day', created_at)::date as day,
           (count(*) filter (where status = 'converted'))::float
             / nullif(count(*), 0)::float * 100 as rate
    from trials
    where created_at >= ${window.from} and created_at <= ${window.to}
    group by 1 order by 1
  `);

  const recentActivityRows = await db.execute(sql`
    select id, type, title, subject, created_at
    from activity_events
    order by created_at desc
    limit 8
  `);

  const recentClientRows = await db
    .select({
      id: clientAccounts.id,
      businessName: clientBusinessProfiles.businessName,
      fullName: clientAccounts.fullName,
      email: clientAccounts.email,
      registeredAt: clientAccounts.createdAt,
      accountStatus: clientAccounts.status,
      tenantRef: tenants.tenantRef,
      slug: tenants.slug,
      storeStatus: tenants.storeStatus,
      storeAdminEmail: tenants.storeAdminEmail,
      storeAdminEmailVerifiedAt: tenants.storeAdminEmailVerifiedAt,
      planName: plans.name,
      subscriptionStatus: subscriptions.status,
      renewalAt: subscriptions.renewalAt,
      amount: subscriptions.price,
      currency: subscriptions.currency,
      trialStatus: trials.status,
      trialEndsAt: trials.endsAt,
    })
    .from(clientAccounts)
    .leftJoin(clientBusinessProfiles, eq(clientBusinessProfiles.clientAccountId, clientAccounts.id))
    .leftJoin(tenants, eq(tenants.clientAccountId, clientAccounts.id))
    .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
    .leftJoin(plans, eq(plans.id, subscriptions.planId))
    .leftJoin(trials, eq(trials.tenantId, tenants.id))
    .orderBy(sql`${clientAccounts.createdAt} desc`)
    .limit(5);

  const activeClients = activeSubs + trialSubs;
  const paidClients = activeSubs;

  return {
    totalClients: metric(totalClients, Math.max(0, totalClients - newClientsThisWindow + previousTotalClients), clientSpark),
    activeClients: metric(activeClients, activeClients, clientSpark),
    trialClients: metric(trialSubs, trialSubs, clientSpark),
    paidClients: metric(paidClients, paidClients, clientSpark),
    mrr: metric(Number(mrr.toFixed(2)), Number(mrr.toFixed(2)), revenueSpark),
    arr: metric(Number((mrr * 12).toFixed(2)), Number((mrr * 12).toFixed(2)), revenueSpark),

    expiredClients: metric(expiredSubs, expiredSubs),
    suspendedClients: metric(suspendedSubs, suspendedSubs),
    paymentsThisMonth: metric(Number(paymentsThisWindow.toFixed(2)), Number(paymentsPreviousWindow.toFixed(2))),
    failedPayments: metric(failedNow, failedPrevious),

    currency: config.payment.currency,
    range: { from: window.from, to: window.to },

    subscriptionStatus: [
      { status: 'active', count: activeSubs },
      { status: 'trial', count: trialSubs },
      { status: 'past_due', count: pastDueSubs },
      { status: 'expired', count: expiredSubs },
      { status: 'suspended', count: suspendedSubs },
      { status: 'cancelled', count: cancelledSubs },
    ].filter((entry) => entry.count > 0),

    trialConversion: {
      totalTrials: trialTotals,
      converted: trialConverted,
      conversionRate: trialTotals === 0 ? 0 : (trialConverted / trialTotals) * 100,
      series: (conversionRows.rows as { day: string; rate: number | null }[]).map((row) => ({
        date: String(row.day),
        value: Number(row.rate ?? 0),
      })),
    },

    recentActivity: (recentActivityRows.rows as {
      id: string;
      type: string;
      title: string;
      subject: string;
      created_at: string;
    }[]).map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      subject: row.subject,
      createdAt: row.created_at,
    })),

    recentClients: recentClientRows.map((row) => ({
      id: row.id,
      tenantId: row.tenantRef,
      businessName: row.businessName ?? row.fullName,
      ownerName: row.fullName,
      email: row.email,
      storeAdminEmail: storeAdminLogin(row),
      storeAdminEmailVerified: row.storeAdminEmailVerifiedAt !== null,
      phone: null,
      registeredAt: row.registeredAt,
      trialStatus: row.trialStatus,
      trialEndsAt: row.trialEndsAt,
      planName: row.planName,
      subscriptionStatus: row.subscriptionStatus,
      renewalAt: row.renewalAt,
      amount: row.amount,
      currency: row.currency ?? config.payment.currency,
      storeStatus: row.storeStatus,
      domain: row.slug ? `${row.slug}.${config.urls.platformRootDomain}` : null,
      lastLoginAt: null,
      accountStatus: row.accountStatus,
    })),
  };
}

export async function buildCharts(window: RangeWindow) {
  const truncUnit = window.bucket;

  const [revenueRows, clientRows, subscriptionRows, conversionRows] = await Promise.all([
    db.execute(sql`
      select date_trunc(${truncUnit}, paid_at)::date as day,
             coalesce(sum(amount), 0)::float as revenue
      from payments
      where status = 'paid' and paid_at >= ${window.from} and paid_at <= ${window.to}
      group by 1 order by 1
    `),
    db.execute(sql`
      select date_trunc(${truncUnit}, created_at)::date as day, count(*)::int as total
      from client_accounts
      where created_at >= ${window.from} and created_at <= ${window.to}
      group by 1 order by 1
    `),
    db.execute(sql`
      select date_trunc(${truncUnit}, created_at)::date as day, count(*)::int as total
      from subscriptions
      where created_at >= ${window.from} and created_at <= ${window.to}
      group by 1 order by 1
    `),
    db.execute(sql`
      select date_trunc(${truncUnit}, created_at)::date as day,
             (count(*) filter (where status = 'converted'))::float
               / nullif(count(*), 0)::float * 100 as rate
      from trials
      where created_at >= ${window.from} and created_at <= ${window.to}
      group by 1 order by 1
    `),
  ]);

  const mrr = await monthlyRecurringRevenue();

  let clientRunning = 0;
  let subscriptionRunning = 0;

  return {
    revenue: (revenueRows.rows as { day: string; revenue: number }[]).map((row) => ({
      date: String(row.day),
      revenue: Number(row.revenue),
      mrr: Number(mrr.toFixed(2)),
    })),
    clients: (clientRows.rows as { day: string; total: number }[]).map((row) => {
      clientRunning += Number(row.total);
      return { date: String(row.day), total: clientRunning };
    }),
    subscriptions: (subscriptionRows.rows as { day: string; total: number }[]).map((row) => {
      subscriptionRunning += Number(row.total);
      return { date: String(row.day), total: subscriptionRunning };
    }),
    trialConversion: (conversionRows.rows as { day: string; rate: number | null }[]).map((row) => ({
      date: String(row.day),
      value: Number(row.rate ?? 0),
    })),
  };
}

export async function supportCounts() {
  const rows = await db.execute(sql`
    select count(*)::int as total from support_tickets where status in ('open', 'in_progress')
  `);
  return { openTickets: Number((rows.rows[0] as { total: number } | undefined)?.total ?? 0) };
}

export async function trialSummary() {
  const soon = addDays(new Date(), 5);
  const [active, expiringSoon, expired, converted] = await Promise.all([
    db.select({ total: count() }).from(trials).where(eq(trials.status, 'active')),
    db
      .select({ total: count() })
      .from(trials)
      .where(and(eq(trials.status, 'active'), lt(trials.endsAt, soon))),
    db.select({ total: count() }).from(trials).where(eq(trials.status, 'expired')),
    db.select({ total: count() }).from(trials).where(eq(trials.status, 'converted')),
  ]);

  return {
    active: Number(active[0]?.total ?? 0),
    expiringSoon: Number(expiringSoon[0]?.total ?? 0),
    expired: Number(expired[0]?.total ?? 0),
    converted: Number(converted[0]?.total ?? 0),
  };
}
