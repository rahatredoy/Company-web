# Client Side — Store Admin, Commerce API, Storefront

The company side sells stores and provisions a database for each one. Everything a store owner
actually *does* lives here.

```
client/
  client-api/     Fastify 5 commerce API        :4100   standalone
  client-admin/   Next.js 16 store admin panel  :3002   standalone
  client-store/   Next.js 16 customer storefront :3003  standalone (later slices)
```

Each folder is its own deployable: own `package.json`, `node_modules`, `.env`, build. Nothing is
shared through a workspace — shared code is **copied**, deliberately, so one app can never break
another on upgrade.

---

## The one rule

**A store's data must never be reachable from another store's request.** Everything below exists to
make that true by construction rather than by discipline.

---

## How a request finds its store

```
browser  →  admin.abc-fashion.company.com        (hostname is the only identity signal)
         →  slug: abc-fashion
         →  company-api GET /internal/tenants/by-slug/abc-fashion   [Redis, 60s]
         →  { tenantRef, status, storeStatus, entitlements, trial }
         →  refuse if status ∈ {suspended, expired, cancelled} or storeStatus ≠ ready
         →  tenant_abc_fashion_db                (name derived, never transmitted)
         →  Drizzle handle from the pool cache
```

A slug in a query string, a body, or a JWT claim is **never** consulted. `plugins/tenant.ts` reads
the `Host` header and nothing else. Verified: `?slug=other-store` on a resolved host is ignored, and
an unknown host is a 404.

`X-Store-Slug` is a development-only escape hatch — Windows and Node do not resolve `*.localhost`.
The API honours it only while its own `DEV_STORE_SLUG` is set, which `config` forces to `undefined`
in production. Its bare fallback (no header, no slug in the host) applies only to a **loopback**
hostname; a real hostname is treated as a custom domain even in development, so domain routing is
exercisable locally instead of only after deploy.

### Custom domains

A hostname like `mystore.com` carries no slug, so the company platform's verified-domain table is
the only authority for it: `GET /internal/tenants/by-domain/<host>`, Redis-cached on the same terms.
Only a **verified, active** row resolves — a hostname merely *pointed* at our IP gets a 404.

A domain is connected for one **surface**, chosen when it was added, and answers for that one only:

| `domain_type` | Serves | Reached at |
| --- | --- | --- |
| `platform_subdomain` | storefront | `<slug>.company.com` |
| `storefront_custom` | storefront | `mystore.com` |
| `admin_custom` | admin panel | `admin.mystore.com` |

`admin.mystore.com` asking for a commerce route, or `mystore.com` asking for `/api/v1/admin/*`,
resolves to nothing and answers `STORE_NOT_FOUND` — the same reply an unconnected hostname gets, so
which other addresses a store owns cannot be mapped out one request at a time. Platform hostnames
are exempt because `api.<slug>.company.com` deliberately serves both; there the two surfaces are
told apart by their own **origins** (`plugins/security.ts`), which is also what makes it work in
development, where both frontends reach the API through `localhost`.

The same split governs CORS and the CSRF origin check: an origin is accepted only for the surface
whose routes it is calling. A storefront renders owner-authored content and is the softer target of
the two, so its origin is refused the admin API even for its own store.

Company-side changes reach this cache immediately rather than at the end of its TTL: connecting,
verifying or removing a domain, suspending or reactivating a store, and a trial or subscription
expiring all delete the cached record (`company-api/src/lib/tenant-cache.ts`, over the Redis both
platforms share — the trust direction stays one-way).

Proof: `cd company/company-api && npx tsx scripts/verify-domain-routing.ts` (13 checks; needs
client-api running).

### Why both status fields are checked

Company-side reactivation can leave `status: 'expired'` with `storeStatus: 'ready'`. Checking
`storeStatus` alone would let an unpaid store keep trading.

---

## Tenant databases

`db/tenant-manager.ts` keeps an LRU of pools: 50 tenants resident, `max: 4` connections each,
closed after 10 idle minutes. Hundreds of stores share one Postgres cluster, so a pool is small and
opened lazily. Concurrent first-requests for the same tenant are collapsed onto one setup by a
`pending` map.

`db/tenant-migrate.ts` brings a tenant up to date on first use, under
`pg_advisory_lock(8147236915002771)` — two API instances booting the same fresh store cannot both
run the migration. `npm run db:migrate:tenants -- --slug abc-fashion` pre-warms after a deploy so no
store pays the ~1–2s cost in-band.

### Migration 0000 is hand-edited on purpose

Company provisioning already created `store_settings`, `store_admins` and `platform_sync`. Migration
0000 therefore uses `CREATE TABLE IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS` for those three, so
applying it to a provisioned database **preserves the seeded owner row**.

> Regenerating `0000_*.sql` with `drizzle-kit generate` discards those edits and will drop the owner.
> Add a new migration instead.

---

## Store admin auth

### One account per store, created on the company side

The panel has no sign-up, no invite and no set-up link. `provisioning.ts` inserts the store's single
admin from the **login the owner chose at the last step of company-side signup**, staged on
`tenants.store_admin_email` / `store_admin_password_hash` and cleared once it has been copied here.
Both platforms hash with the same Argon2id parameters, so this side verifies the hash directly and
never sees the plaintext.

```
POST /auth/login              → email + password, the only way in
POST /auth/forgot-password    → always 200, emails a single-use 60m link
POST /auth/reset-password     → sets a new password, kills every session
```

This credential is **independent of the SaaS account** on the company side: they may use different
email addresses, and changing or resetting one does not touch the other. A forgotten panel password
is recovered through the panel's own reset, above.

### A second admin is impossible, not merely absent

No route creates an admin, and `store_admins_singleton_key` — a unique index on a constant, added by
migration 0002 and by the company bootstrap schema — means the database refuses a second row even if
one day something tries. That is deliberate: a store's admin panel is one person's, and an extra
account is one more credential to lose.

An admin row that somehow has no password cannot sign in: login answers `ACCOUNT_NOT_READY`, which
is a provisioning failure to be fixed on the company side, not something a visitor can resolve.

### Sessions

Opaque 32-byte tokens; only the SHA-256 is stored. The row lives in the tenant's own database and
carries `tenant_ref`, so a token minted for one store is simply absent from another store's table —
cross-tenant replay fails before the `tenant_ref` comparison, which is the second line of defence.

| Audience | Cookie | Never interoperates with |
| --- | --- | --- |
| store admin | `store_admin_session` | `company_admin_session`, `company_client_session` |
| MFA challenge | `store_admin_mfa` | anything — cannot satisfy `requireStoreAdmin` |

`GET /auth/session` is deliberately **unguarded**: a signed-out visitor gets
`{ authenticated: false }`, never a 401. Guarding it is what made the company panel loop on its login
page.

### Cookie domain is per store

The panel and the API are different hostnames, so a host-only cookie would never reach the panel's
server render. The cookie is scoped to `.<slug>.company.com` — both hostnames of that store, and no
other store's. Scoping to `.company.com` would offer one store's session to every other store's
origin, so the platform root is refused in code rather than left to configuration.

### Permissions

`STORE_SUPER_ADMIN` holds everything implicitly and is **not** represented in
`admin_user_permissions` — their access cannot be revoked by deleting rows, so a bug in the grants
table can never lock an owner out of their own store. `STORE_ADMIN` holds only what was granted.

Enforced in Fastify on every mutating route:

```ts
{ preHandler: [app.requireStoreAdmin, app.requirePermission('products.create')] }
```

Hiding a button is not authorisation. The sidebar filters itself for tidiness only.

---

## Templates and themes

**6 templates × 8 themes = 48 combinations.** A theme only ever redefines CSS custom properties, so
changing colour cannot change layout, and changing layout cannot change product data.

```
marketplace  modern_shop (default)  fashion_boutique  minimal_store  electronics  lifestyle
royal_blue (default)  emerald_green  luxury_black  rose_pink
modern_purple  sunset_orange  midnight_navy  olive_premium
```

A template exports only chrome and a 12-field preset — header, footer, homepage, card variant, grid
classes, section rhythm. No commerce logic lives in one, which is why all six render the same
`components/commerce/*` and the same section renderer.

`storefront_settings.template_key` is authoritative and uses **underscore** keys. The company side
seeds hyphenated values (`modern-shop`); `normaliseTemplateKey()` translates on read and
`ensureStoreSeed` normalises the stored value once. Unknown keys fall back rather than rendering an
unstyled page.

---

## Running it

```bash
# 1. company control plane (tenant resolution depends on it)
cd company/company-api && npm start          # :4000

# 2. commerce API
cd client/client-api && npm start            # :4100
npm run db:migrate:tenants -- --slug abc-fashion

# 3. store admin panel
cd client/client-admin && npm run dev        # :3002
```

With `MAIL_DRIVER=log`, reset links are written to the API log — that is how you read them locally.

---

## Verification

`client-api/scripts/verify-slice0.ts` runs against the live cluster and the real tenant
`abc-fashion` / `TNT-WU1SNE55` / `tenant_abc_fashion_db`. It uses `node:http` rather than `fetch`,
because `fetch` silently drops the `Host` header and the hostname is the whole point.

```
npx tsx scripts/verify-slice0.ts        →  43 passed, 0 failed
```

Covering: unknown hostname refused · query-string slug ignored · provisioned owner preserved as
`STORE_SUPER_ADMIN` with an `$argon2id$` hash · the registered password signs in · no set-up
endpoint survives · an account without a password is refused as `ACCOUNT_NOT_READY` · **the database
refuses a second admin account** · plan code read from the control plane rather than the broken
`plan_code` column · company-admin cookie cannot authenticate · forged cookie refused · session
stored only as a hash and pinned to the tenant · `requirePermission` refuses an ungranted key ·
suspended/expired/cancelled/not-ready stores each refused with their own code · sign-in throttled
per IP.

`scripts/verify-storefront.ts` covers the public surface, and needs two real stores because the
claim it exists to check is about the boundary between them:

```
npx tsx scripts/verify-storefront.ts --slug abc-fashion --password '…' --other e-comarch
                                        →  34 passed, 0 failed
```

Covering: every storefront route reads with no session · an unknown hostname is `STORE_NOT_FOUND` ·
a fresh store has navigation, a homepage, policy pages and a payment method · **a draft product is
absent from the listing and its detail page 404s** · publishing it puts it on the website on the
very next read, with no TTL to wait out · unpublishing takes it off again · an inactive category is
missing rather than "hidden" · stock is a band and never a count · cost price is never serialised ·
a storefront origin still cannot reach the admin API · a slug in the query string is ignored ·
**and a product created on one store is absent from the other store's website.**

---

## The storefront read path

`client-api/src/modules/storefront/` is the public surface. It has no auth guard of any kind, which
is exactly why every query filters to published rows — `status = 'active'`, `is_active`,
`status = 'published'`, `status = 'approved'`. The store admin session is what separates the panel's
view of a catalogue from a shopper's, and there is no session here.

`client-store` consumes it with `NEXT_PUBLIC_DATA_SOURCE=live`. Its second flag,
`NEXT_PUBLIC_COMMERCE_SOURCE`, is still `mock`: there is no cart, checkout or customer session on
this API yet, and one flag would have made every account page a 404 the moment the shop started
working.

An admin write drops this store's storefront cache on its way out — an `onResponse` hook registered
once in `modules/catalog/routes.ts`, rather than a call in each handler that a future route could
forget. The remaining delay is the storefront's own ISR window (60s on listings, 300s on taxonomy),
which is a deliberate trade and the honest ceiling on freshness.

---

## Taking an order

The account half of the surface is guarded by `requireCustomer` — `store_customer_session`, rows in
`customer_sessions`, a fourth cookie family that satisfies none of the other three and carries no
permissions at all. Checkout itself uses `optionalCustomer`: it is a **guest flow**, because
requiring an account in order to buy something is how a shop loses the sale.

**The request carries ids and quantities and no money.** Price, sale window, coupon, shipping and
every total are recomputed from the tenant database, because the basket lives in `localStorage` and
anything priced there is a number the customer could have edited. Stock moves `available → reserved`
in a single conditional `UPDATE`; the `>= 0` CHECK constraints turn a race for the last unit into
`INSUFFICIENT_STOCK` rather than an oversell.

Three details that are easy to get wrong and are checked by the script:

- `GET /account/me` answers **404, not 401**, when signed out. The account layout redirects on a
  null customer; a 401 would throw and take the page out instead.
- A guest who has just paid gets back onto their own receipt through `store_guest_orders` — an
  opaque cookie whose SHA-256 keys a Redis set of the orders that browser placed. An order number
  alone is still never enough to read an order.
- Coupons are validated **only** on the server. The storefront used to hold two hardcoded tables
  that already disagreed with each other about one code's minimum; both are gone.

Payment is cash on delivery plus a `mock` gateway, neither needing credentials. Stripe and
SSLCommerz are adapter seams.

---

## Status

| Slice | State |
| --- | --- |
| 0 — foundation, tenant resolution, store-admin auth, admin shell | **done, verified** |
| 1 — catalogue: categories, brands, products | **done, verified** (`scripts/verify-catalog.ts`, 40 checks) |
| 9 — storefront **read** path, `client-store` on live data | **done, verified** (`scripts/verify-storefront.ts`, 34 checks) |
| 10–12 — customer accounts, checkout, orders, tracking, returns, reviews | **done, verified** (`scripts/verify-commerce.ts`, 55 checks) |
| 2–8 — the admin panel's own sections | **done, verified** (`scripts/verify-admin.ts`, 96 checks) |

The storefront is a working shop: a visitor can register, buy as a guest or as an account holder,
pay by cash on delivery or through the test gateway, track, cancel and return an order, and leave a
review that waits for moderation. Cart, wishlist and compare stay in the visitor's own browser by
design.

**All 20 of `client-admin`'s sidebar destinations are built.** An owner can run the shop end to end:
take an order through to delivery, adjust stock against a ledger, moderate reviews, quote delivery,
work a return through to a refund, issue discount codes, edit the pages the storefront renders, and
change the layout and colour. `app/(dashboard)/[...section]/page.tsx` is now a plain 404 — its
"coming soon" branch is unreachable and was removed.

Images upload straight from the panel to Cloudflare R2 — product photos, banners, logo and favicon.
`lib/storage.ts` signs the request itself rather than pulling in the AWS SDK, and uploads are
**proxied through the API rather than presigned**, so size, type and the caller's permission are all
checked by something the uploader cannot edit. Files are served from `R2_PUBLIC_URL`; the
credentialed endpoint never reaches a page.

259 checks pass across the five verification scripts, and each is repeatable back to back — they
clear their own rate-limit counters and delete their own fixtures in SQL, since the API's protective
soft-delete would otherwise leave a SKU or a code taken.
