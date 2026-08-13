import type { customerAddresses, customers } from '../../db/schema/index';

type CustomerRow = typeof customers.$inferSelect;
type AddressRow = typeof customerAddresses.$inferSelect;

export interface CustomerView {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  emailVerified: boolean;
  acceptsMarketing: boolean;
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
    acceptsMarketing: row.acceptsMarketing,
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
