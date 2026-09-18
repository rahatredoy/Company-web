import type { customerAddresses, customers } from '../../db/schema/index';

type CustomerRow = typeof customers.$inferSelect;
type AddressRow = typeof customerAddresses.$inferSelect;

export interface CustomerView {
  id: string;
  fullName: string;
  /** Null on an account created from a phone number that has not added one. */
  email: string | null;
  phone: string | null;
  /** True only of an address that was actually proved, never merely present. */
  emailVerified: boolean;
  /** The number a phone sign-in matches, in E.164 — null unless one was proved. */
  phoneE164: string | null;
  phoneVerified: boolean;
  /**
   * Whether a password exists at all. False for an account created by phone or
   * by Google, which is what lets the account screen offer "set a password"
   * rather than a "change password" form with nothing to change.
   */
  hasPassword: boolean;
  acceptsMarketing: boolean;
  /** `YYYY-MM-DD`. What a birthday offer is checked against. */
  birthDate: string | null;
}

export interface AddressView {
  id: string;
  label: string | null;
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string | null;
  postalCode: string | null;
  country: string;
  isDefault: boolean;
}

/**
 * The customer, as the customer is allowed to see themselves.
 *
 * A whitelist rather than a spread, and that is the point: `customers` also
 * holds `password_hash`, `failed_login_count`, `locked_until`, `last_login_ip`,
 * `customer_type` and a staff-only `admin_note`. A `...row` here would have put
 * every one of them in a response the moment the column was added.
 */
export function customerView(row: CustomerRow): CustomerView {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    emailVerified: row.emailVerifiedAt !== null,
    phoneE164: row.phoneE164,
    phoneVerified: row.phoneVerifiedAt !== null,
    // The hash itself is never sent — the whole reason this is a whitelist.
    hasPassword: row.passwordHash !== null,
    acceptsMarketing: row.acceptsMarketing,
    birthDate: row.birthDate,
  };
}

export function addressView(row: AddressRow): AddressView {
  return {
    id: row.id,
    label: row.label,
    fullName: row.fullName,
    phone: row.phone,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
    isDefault: row.isDefault,
  };
}
