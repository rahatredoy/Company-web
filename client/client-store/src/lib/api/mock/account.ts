import type { Address, Customer, ReturnSummary } from '@/types';
import { rngFor } from './fixtures';

/**
 * Customer accounts, in the fixture layer.
 *
 * `client-api` has no customer auth at all yet — no register, no login, no
 * session audience for a shopper. This stands in for it so the account area can
 * be built and walked, and it is written to the same shape the real endpoints
 * will have, so swapping it out changes `lib/api/account.ts` and nothing else.
 *
 * **This is not authentication.** Passwords are compared in plain text and
 * sessions are a random string in a `Map`. That is acceptable for a fixture
 * that never leaves a developer's machine and would be indefensible anywhere
 * else — which is why `isMockData` gates every path that reaches it.
 */

interface StoredAccount {
  customer: Customer;
  password: string;
  addresses: Address[];
}

const ACCOUNT_STORE = Symbol.for('storefront.mock.accounts');
const SESSION_STORE = Symbol.for('storefront.mock.sessions');

type Globals = Record<symbol, unknown>;
const globals = globalThis as unknown as Globals;

// Held on `globalThis` for the same reason orders are: a route handler and a
// page are separate module instances in Next's server runtime.
const accounts = (globals[ACCOUNT_STORE] ??= new Map<string, StoredAccount>()) as Map<
  string,
  StoredAccount
>;
const sessions = (globals[SESSION_STORE] ??= new Map<string, string>()) as Map<string, string>;

/** A demo account so the signed-in area is walkable without registering. */
const DEMO_EMAIL = 'you@example.com';

function seed() {
  if (accounts.has(DEMO_EMAIL)) return;

  accounts.set(DEMO_EMAIL, {
    password: 'password',
    customer: {
      id: 'cust-demo',
      fullName: 'Sample Customer',
      email: DEMO_EMAIL,
      phone: '+880 1700 000000',
      emailVerified: true,
      acceptsMarketing: true,
    },
    addresses: [
      {
        id: 'addr-1',
        label: 'Home',
        fullName: 'Sample Customer',
        phone: '+880 1700 000000',
        addressLine1: 'House 12, Road 7',
        addressLine2: 'Block C',
        city: 'Dhaka',
        state: 'Dhaka',
        postalCode: '1212',
        country: 'Bangladesh',
        isDefault: true,
      },
      {
        id: 'addr-2',
        label: 'Office',
        fullName: 'Sample Customer',
        phone: '+880 1900 000000',
        addressLine1: '44 Gulshan Avenue',
        addressLine2: null,
        city: 'Dhaka',
        state: 'Dhaka',
        postalCode: '1212',
        country: 'Bangladesh',
        isDefault: false,
      },
    ],
  });
}

seed();

function newToken(seedValue: string): string {
  const rng = rngFor(`session:${seedValue}:${sessions.size}`);
  return Array.from({ length: 4 }, () => rng.int(100000, 999999)).join('-');
}

export async function mockRegister(input: {
  fullName: string;
  email: string;
  phone?: string | null;
  password: string;
}): Promise<{ token: string; customer: Customer } | { error: 'email_taken' }> {
  const email = input.email.toLowerCase();
  if (accounts.has(email)) return { error: 'email_taken' };

  const customer: Customer = {
    id: `cust-${accounts.size + 1}`,
    fullName: input.fullName,
    email,
    phone: input.phone ?? null,
    // Real registration sends a verification email; nothing here can.
    emailVerified: false,
    acceptsMarketing: false,
  };

  accounts.set(email, { customer, password: input.password, addresses: [] });

  const token = newToken(email);
  sessions.set(token, email);
  return { token, customer };
}

export async function mockLogin(
  email: string,
  password: string,
): Promise<{ token: string; customer: Customer } | null> {
  const account = accounts.get(email.toLowerCase());
  // Same null for "no such account" and "wrong password": telling them apart is
  // an account-enumeration oracle, and the real endpoint must not either.
  if (!account || account.password !== password) return null;

  const token = newToken(email);
  sessions.set(token, account.customer.email);
  return { token, customer: account.customer };
}

export async function mockLogout(token: string): Promise<void> {
  sessions.delete(token);
}

export async function mockCustomer(token: string | undefined): Promise<Customer | null> {
  if (!token) return null;
  const email = sessions.get(token);
  return email ? (accounts.get(email)?.customer ?? null) : null;
}

export async function mockAddresses(token: string | undefined): Promise<Address[]> {
  if (!token) return [];
  const email = sessions.get(token);
  return email ? (accounts.get(email)?.addresses ?? []) : [];
}

export async function mockUpdateCustomer(
  token: string | undefined,
  patch: Partial<Pick<Customer, 'fullName' | 'phone' | 'acceptsMarketing'>>,
): Promise<Customer | null> {
  if (!token) return null;
  const email = sessions.get(token);
  const account = email ? accounts.get(email) : undefined;
  if (!account) return null;

  account.customer = { ...account.customer, ...patch };
  return account.customer;
}

/** Two sample returns, so the returns view is not permanently empty. */
export async function mockReturns(token: string | undefined): Promise<ReturnSummary[]> {
  if (!token || !sessions.has(token)) return [];

  return [
    {
      id: 'ret-1',
      returnNumber: 'RET-4471',
      orderNumber: 'ORD-100201',
      status: 'approved',
      resolution: 'refund',
      requestedAt: '2026-06-14T09:20:00.000Z',
      itemCount: 1,
    },
    {
      id: 'ret-2',
      returnNumber: 'RET-4402',
      orderNumber: 'ORD-100202',
      status: 'completed',
      resolution: 'exchange',
      requestedAt: '2026-05-02T14:05:00.000Z',
      itemCount: 2,
    },
  ];
}
