# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

A multi-tenant e-commerce SaaS platform split into **six independently deployable applications**. There is no monorepo tooling — no workspaces, no shared package, and no dependencies at the root. Every app owns its `package.json`, `node_modules`, `.env`, `tsconfig.json` and build. The root `package.json` is a **launcher only**: it declares no dependencies and no `workspaces`, so never run `npm install` there — a root lockfile would change the workspace root the four Next apps infer for output file tracing. Shared logic (slug parsing, API fetch wrapper, error codes, UI primitives) is **copied on purpose** so upgrading one app can never break another; when you change a copied helper, decide explicitly whether its twins need the same change.

| App | Port | Stack | Role |
| --- | --- | --- | --- |
| [company/company-web](company/company-web/) | 3000 | Next.js 16 App Router | Public SaaS site **and** the signed-in client dashboard (`/dashboard`) |
| [company/company-admin](company/company-admin/) | 3001 | Next.js 16 | Company super-admin panel (one admin, ever) |
| [company/company-api](company/company-api/) | 4000 | Fastify 5 + Drizzle | Control plane; owns `company_control_db` |
| [client/client-admin](client/client-admin/) | 3002 | Next.js 16 | Store admin panel (one deployment, every store) |
| [client/client-store](client/client-store/) | 3003 | Next.js 16 | Customer storefront (6 templates × 6 themes) |
| [client/client-api](client/client-api/) | 4100 | Fastify 5 + Drizzle | Commerce API; one database per tenant |

Node ≥ 22, TypeScript 5.9, React 19, Tailwind 4, Zod 4 everywhere. The four Next apps use the `@/*` → `./src/*` alias; the two APIs are ESM (`"type": "module"`) run through `tsx`, and import with **extensionless relative paths** (`./config/index`), not the alias.

## Commands

Run from inside an app folder. Both APIs deliberately have no `lint` script; the Next apps have no `test` script — there is no test framework anywhere (see Verification below).

```bash
npm run dev          # every app
npm run typecheck    # every app — the primary correctness gate
npm run lint         # Next apps only (eslint)
npm run build        # Next apps only
npm run worker:dev   # APIs only — BullMQ worker, separate process
```

Start everything at once from the repo root. Both launchers pre-check ports and skip an app that is already listening; they differ only in where the logs go.

One terminal, output prefixed per app, one Ctrl+C stops every app it started:

```bash
npm run dev            # all six
npm run dev:company    # or: dev:client | dev:api | dev:web
npm run dev:workers    # all six plus both BullMQ workers
```

One PowerShell window per app, each stoppable on its own — `npm run dev:windows` is the same thing:

```powershell
.\dev.ps1                  # all six
.\dev.ps1 company          # or: client | api | web
.\dev.ps1 all -Workers     # plus both BullMQ workers
```

[dev.mjs](dev.mjs) backs the npm scripts and is deliberately dependency-free. It only spawns each app's own `npm run dev` in its own folder — it never links them.

### Database — company-api (one control database)

```bash
npm run setup        # bootstrap + generate + migrate + seed, in order
npm run db:bootstrap # creates company_control_db if missing
npm run db:generate  # regenerate SQL from src/db/schema
npm run db:migrate
npm run db:seed      # plans, settings, the single admin
npm run db:studio
```

### Database — client-api (one database per tenant, across shards)

```bash
npm run db:migrate:tenants -- --slug abc-fashion   # pre-warm one store after deploy
npm run db:migrate:tenants                          # all tenants
npm run db:generate                                 # see the two warnings below
```

Which server a store's database is on is `company-api`'s decision — see *The tenant cluster is sharded* below. To move one:

```bash
cd company/company-api
npx tsx scripts/move-tenant-to-shard.ts --slug abc-fashion --to shard-2
npx tsx scripts/move-tenant-to-shard.ts --all --to shard-1 --drop-source
```

### A store to sign in to (local development)

```bash
cd company/company-api
npx tsx scripts/create-client.ts --email owner@example.com --password 'Secret@2026' --store "Riyad Store"
npx tsx scripts/create-test-clients.ts        # two fixed fixtures; --drop removes them
```

`create-client.ts` gives one email a working **store admin panel** login, and is idempotent: it drives the real signup flow (plan → payment webhook → website → admin panel → passcode) for an account with no store, resumes a half-finished one, and for a store that is already live only rewrites the panel credential. It deletes nothing, so it is safe against a real account whose password nobody remembers. Three things bypass the browser and only these: the account is created already verified, the emailed passcode is planted the way the API writes it, and the login is written into the tenant database — where the panel's credential lives. Provisioning runs inline if no BullMQ worker picks the job up within 15 seconds. `create-test-clients.ts` is the older fixture pair, which **drops and rebuilds** its two accounts on every run.

Plain `http://localhost:3002` and `:3003` always open the store named by `DEV_STORE_SLUG` (client-api) / `NEXT_PUBLIC_DEV_STORE_SLUG` (client-admin, client-store) — keep those three in step. Every other store is reached at `http://<slug>.localhost:3002`, which browsers resolve even though Windows and Node do not.

### Verification (there is no test runner)

Correctness is checked by `tsx` scripts that hit the **live** API and real databases:

```bash
cd client/client-api
npx tsx scripts/verify-slice0.ts              # 34 checks: tenant isolation + store-admin auth
npx tsx scripts/verify-catalog.ts             # 40 checks: categories, brands, products
npx tsx scripts/verify-storefront.ts --slug abc-fashion --password '…' --other e-comarch   # 34 checks: the public read path
npx tsx scripts/verify-commerce.ts   --slug abc-fashion --password '…' --other e-comarch   # 55 checks: accounts, checkout, orders, returns, reviews
npx tsx scripts/verify-admin.ts      --slug abc-fashion --password '…'                     # 96 checks: every admin section, uploads included
npx tsx scripts/verify-schema.ts --slug abc-fashion
npx tsx scripts/set-store-password.ts

cd company/company-api
npx tsx scripts/verify-signup-flow.ts          # billing setup → bill paid → website → admin panel → passcode, plus the admin password reset
npx tsx scripts/verify-signup-flow.ts --pay-now # same, as a purchase instead of a trial
npx tsx scripts/set-trial-days.ts --days 7     # db:seed only ever *creates* the settings groups
npx tsx scripts/verify-dashboard-states.ts     # the dashboard rendered for 3 real accounts, billing gate included
npx tsx scripts/verify-admin-trusted-device.ts # 24 checks: admin sign-in, passcode, remembered browser
npx tsx scripts/verify-domain-routing.ts       # 13 checks: hostname → tenant → surface; needs client-api on 4100
npx tsx scripts/list-tenants.ts
npm run admin:credentials -- --email you@example.com --password '…'   # move the one admin login
```

`verify-signup-flow.ts` creates a throwaway account, provisions a real tenant database, asserts the bill was required and settled at the right amount (0.00 on a trial) and left an invoice behind, asserts the store admin login is the one setup chose and confirmed by passcode (and that the SaaS password does *not* open the panel), resets that password and checks the new one took, asserts the free trial cannot be taken a second time, then drops both again — pass `--keep` to inspect the result. `verify-dashboard-states.ts` additionally needs **company-web running on 3000**: it renders `/dashboard` for an account with no plan, one that has paid but has no store, and one with a live store, and checks each screen says the right thing. `verify-admin-trusted-device.ts` plants a known passcode hash on its own challenge row rather than reading an inbox, and leaves the admin signed out of every session with every browser forgotten — do not run it while you are signed in to the panel.

`verify-slice0.ts` uses `node:http` rather than `fetch` on purpose — `fetch` drops a custom `Host` header, and the hostname is the entire tenant-identity mechanism. It is pinned to the `abc-fashion` fixture and names that store in the `Host` header of every call, so it does not follow `DEV_STORE_SLUG`; `--slug` with `--email`/`--password` points it at another store. `verify-domain-routing.ts` does the same for connected custom domains: it plants verified `storefront_custom` and `admin_custom` rows on a `.test` hostname (DNS verification cannot be performed for a test domain, and everything downstream of that flag is what is under test), checks each resolves to its own store and its own surface only, checks an unverified and an unknown host resolve to nothing, and checks a removed domain stops resolving immediately rather than at the end of the cache TTL — then removes them again, unless `--keep`.

## Architecture

### Two planes, one direction of trust

```
company-web / company-admin ──▶ company-api ──▶ company_control_db
                                     │                (SaaS business data only)
                                     ├──▶ Redis (sessions, rate limit, BullMQ)
                                     └──▶ provisioning ──▶ tenant_<slug>_db
                                                                ▲
client-admin / client-store ──▶ client-api ─────────────────────┘
                                     │
                                     └──▶ company-api /internal/* (x-internal-key)
```

`company_control_db` holds accounts, plans, trials, subscriptions, payments, invoices, domains, provisioning, support, audit — and **never** commerce data. Commerce data lives only in the per-tenant databases. `client-api` never opens the control database; it asks `company-api` over `/api/v1/internal/*` and caches the answer in Redis.

All four frontends are pure API consumers: no database URL, no payment or storage secret, only `NEXT_PUBLIC_*` values. Only the two APIs hold secrets.

`NEXT_PUBLIC_API_URL` (client-admin) and `NEXT_PUBLIC_COMMERCE_API_URL` (client-store) are **patterns**, not fixed addresses: one build serves every store, and `client-api` identifies the store from the `Host` header alone, so a single shared API origin would make every store's requests indistinguishable. `{slug}` is substituted at runtime from the hostname the visitor reached (`lib/env.ts#apiBaseForHost`, `lib/tenant/host.ts#apiBaseForHost`), and a server component — which cannot set `Host` on an outgoing `fetch` — is handed the resolved origin by `lib/server-api.ts#storeCall` / `lib/tenant#storeCall` alongside the dev slug header, so a call site cannot pick up one without the other. On a connected custom domain there is no slug to substitute, so the call goes to the visitor's own origin and **the edge proxy must forward `/api/*` to client-api with the original `Host` intact** — a Next.js rewrite cannot stand in, because a rewrite replaces `Host` with the destination's.

### How a request finds its store (client side)

`client-api/src/plugins/tenant.ts` derives the store from the `Host` header and nothing else — never a query string, body field or token claim. Hostname → slug → `company-api` lookup (Redis-cached) → refuse unless `status ∉ {suspended, expired, cancelled}` **and** `storeStatus === 'ready'` (both are checked because reactivation can leave them disagreeing) → tenant database name derived locally, never transmitted → pooled Drizzle handle from `db/tenant-manager.ts` (LRU of 50 tenants, `max: 4` connections, closed after 10 idle minutes).

### The admin panel

**All 20 sidebar destinations are built.** `client-api`'s admin modules are `catalog`, `orders`, `customers`, `reviews`, `inventory`, `fulfilment` (shipping/returns/refunds), `marketing` (coupons/banners/newsletter), `website` (design/pages/FAQs/homepage) and `settings` (settings/payment methods/attributes/reports); `client-admin` renders each. `app/(dashboard)/[...section]/page.tsx` is now a plain 404 — its "coming soon" branch became unreachable and was removed rather than left to rot.

Every module follows the same shape: `preHandler: [app.requireStoreAdmin, app.requirePermission(k)]` on every route, module-local Zod through `parseBody`/`parseQuery`, `ok`/`paginated`/`noContent`, `audit()` **after** the transaction commits, and `invalidateStorefrontOnWrite(app)` registered once per module that changes public data. On the UI side: async server component + `serverGetPaginated`, `export const dynamic = 'force-dynamic'`, and writes through the browser `api.*` client inside a `'use client'` component — **there is no `serverPost`**. Radix `Select` contributes nothing to `FormData`, so forms use a plain `<select>`.

Rules worth knowing before changing any of it:

- **Status graphs are server-side.** `ORDER_TRANSITIONS` in `lib/constants.ts` — not the enum — decides what an order may become next, and returns and refunds have their own maps in `modules/fulfilment/`. The panel only renders `allowedTransitions`; the API re-checks, so a stale page gets a clear 409 rather than a bad write.
- **Stock only ever moves by a single conditional `UPDATE`**, and every movement writes an `inventory_transactions` row in the same transaction. The `>= 0` CHECK constraints are the backstop: an overdraw fails as `INSUFFICIENT_STOCK` (matched on SQLSTATE `23514`, because Drizzle wraps the driver error and the constraint name is on the `cause`, not the message).
- **`sold_count` moves on dispatch, nowhere else** — counting it at checkout would rank abandoned and cancelled orders as best sellers.
- **Deleting is often archiving**: a product that has sold, a coupon that has been claimed, a customer at all (there is no delete — order history points at them; blocking is the lever). A newsletter subscriber is marked unsubscribed rather than deleted, because a deleted row is one the next signup silently re-adds.
- **`pages.body_html` is sanitised on write** by `lib/sanitise.ts` — the storefront renders it as HTML trusting exactly that. It is a deliberate copy of `client-store/src/lib/sanitise-html.ts`, which runs again at render.
- **A policy page cannot be deleted** (`systemKey` set): the footer and checkout copy link to it, and removing one leaves dead links nobody looks for.
- **Currency cannot change once the store has taken an order.** Prices are decimals with no currency of their own, so switching the code re-labels every past total rather than converting it.
- **A store has exactly one admin**, enforced by `store_admins_singleton_key`. No endpoint creates one, so `/staff` explains that rather than offering an invite that the database would refuse.

### File storage

Cloudflare R2, signed by hand in `lib/storage.ts` — ~60 lines of SigV4 HMAC chaining rather than `@aws-sdk/client-s3`, which would be the largest dependency in an API that has seventeen and hand-rolls its own TOTP and HTML sanitiser for the same reason. Take the SDK the moment multipart, resumable or lifecycle work is needed; a single signed `PUT` is not that moment.

`POST /api/v1/admin/uploads?purpose=…` is **proxied, not presigned**. A presigned `PUT` is faster and is the usual advice, but it moves the size and type checks to the one party that cannot be trusted to apply them. `purpose` also picks the permission — `products` needs `products.update`, `banners` needs `marketing.manage` — because a single "can upload" permission does not exist in the seeded catalogue and inventing one would let an admin bypass the section they are barred from.

Three things worth knowing. `@fastify/multipart`'s `toBuffer()` **resolves even when the stream was truncated at the limit**, so `file.file.truncated` is the only thing separating a 10MB file from the first 10MB of a 400MB one. Keys are `stores/<tenantRef>/<folder>/<uuid>.<ext>` — namespaced so a shared bucket stays legible, and UUID-named because a user-chosen filename can collide or carry a path. And **deleting removes the object immediately but not the CDN copy**: the public domain sits behind a four-hour `max-age`, so the old URL keeps answering `200` from the edge. That is harmless only because keys are never reused.

Credentials live in `client-api/.env` as `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` (Cloudflare's own names) and never leave `lib/storage.ts`; files are addressed on `R2_PUBLIC_URL`, never the credentialed endpoint.

Two rules the rest of the catalogue has to keep. **A `simple` product still owns exactly one variant** — the schema says so, so that pricing, stock and order lines never need two code paths — and `products.routes.ts` writes the product and that variant in one transaction, denormalising its price onto `products.price_from`. **A rename never moves a slug**: it is re-derived only when the slug itself was the field being changed, because a live storefront URL that silently moves breaks every link to it. A slug that is *derived* and clashes gets a numeric suffix; one that was *asked for* and clashes is refused (`SLUG_TAKEN`).

Deleting is not always deleting: a product with `sold_count > 0` is set inactive instead and the response says `deleted: false`, because order lines point at it. A category with children is refused outright (`CATEGORY_HAS_CHILDREN`) — `parent_id` carries no foreign key, so nothing else would stop the subtree being orphaned.

### The storefront

`client-api/src/modules/storefront/` serves `/api/v1/storefront/*` and has two halves.

**The catalogue half is unguarded, and therefore may never return an unpublished row** — the same fact twice. The store admin session is what separates the panel's view of the catalogue from a shopper's, and there is no session here, so the filter lives in the query: `status = 'active'`, `is_active`, `status = 'published'`, `status = 'approved'`. `scripts/verify-storefront.ts` is what proves it still does.

**The account half is guarded by `requireCustomer`** — a fourth cookie family (`store_customer_session`, rows in `customer_sessions`) that satisfies none of the other three and carries no permissions at all. `lib/session.ts` owns it alongside the admin ones so it inherits `cookieDomain`, the per-store `.{slug}.{root}` scoping that is the reason one store's session cannot be offered to another store's origin.

**Checkout sits between the two.** `optionalCustomer` attaches a shopper when one is signed in and says nothing when there is not, because requiring an account in order to buy something is how a shop loses the sale. The request carries **ids and quantities and no money at all** — price, sale window, coupon, shipping and totals are every one of them recomputed from the tenant database, because the basket lives in `localStorage` and anything priced there is a number the customer could have edited. Stock moves `available → reserved` with a **single conditional `UPDATE`**, never read-modify-write; the `>= 0` CHECK constraints are what turn a race for the last unit into `INSUFFICIENT_STOCK` rather than an oversell.

Two things worth knowing. `GET /account/me` answers **404, not 401**, when signed out — the storefront's account layout redirects on a null customer and a 401 would throw instead. And a guest who has just paid is let back onto their own receipt by `store_guest_orders`, an opaque cookie whose SHA-256 keys a Redis set of the order numbers that browser placed; without it `/checkout/success/<n>` would 401 the customer who had just bought something.

Payment is **COD plus a `mock` gateway** (`services`… `payments.routes.ts`), both live in the `payment_provider` enum and neither needing credentials. Stripe and SSLCommerz are adapter seams. The mock gateway confirms over GET because a form POST from the API's own origin would be refused by the CSRF hook; a real gateway posts a signed webhook to the tenant-exempt `/api/v1/webhooks` prefix instead, where `payment_webhook_events`' unique `(provider, event_id)` makes a redelivery a no-op.

Three things worth knowing. `surfaceOf` in `lib/urls.ts` already reads every path that is not `/api/v1/admin` as the storefront, so these routes inherit the storefront's CORS origins and are refused to an admin-panel origin without naming themselves in `plugins/security.ts` — which is why they are registered as their own prefix in `app.ts` rather than beside the admin routes. `lib/cache.ts#invalidateStorefrontOnWrite` is an `onResponse` hook registered by `modules/catalog/routes.ts`, not a call in each handler, because a rule that says "remember to invalidate" holds only until somebody adds a route; without it a save takes up to five minutes to reach the shop. And a homepage section that names a `source` (`new_arrivals`, `featured`, `best_selling`, `sale`) has its `productIds` resolved server-side in `home.routes.ts` — the storefront renders product blocks from an explicit id list, which can never contain a product that did not exist when the section was saved.

A newly provisioned store is seeded with a usable shop by `services/store-content-seed.ts`: navigation, a homepage, the six policy pages, FAQs, cash-on-delivery, a default warehouse, zone and shipping method. It is guarded on the `content_seed_version` key in `platform_sync`, **not** on "is the table empty" — an owner who deletes the seeded pages must not get them back on the next request.

### The tenant cluster is sharded

No single PostgreSQL server holds every store. `TENANT_SHARDS` is a JSON registry of servers, listed identically in **both** APIs' `.env`, and each store records which one it landed on in `tenants.database_shard`. `company-api` picks the shard with the most room left when a store is provisioned (`services/tenant-shards.ts#pickShardForNewTenant`); a shard at `capacity: 0` is never chosen, which is how one is drained.

Only the shard **id** crosses between the platforms — `/internal/tenants/by-slug` publishes it and each side resolves it against its own registry, so hosts and passwords stay put and the control plane cannot point a store's traffic at a server the commerce API was not configured for. An id `client-api` does not know fails loudly (`TENANT_UNAVAILABLE`) rather than falling back to a guess. `TENANT_DB_*` is the pre-sharding server, registered as the `legacy` shard at zero capacity and used for any tenant whose row names no shard.

`company-api/scripts/move-tenant-to-shard.ts` moves a store: dump, restore, compare every table's row count, and only then repoint the tenant row — the source database is left behind unless `--drop-source` is passed. Because that leftover copy answers to the same name, **the recorded shard is the only authority**; `locateShard` is a fallback for a store the control plane cannot answer for, and it tries `legacy` last.

`X-Store-Slug` is a development-only escape hatch because Windows and Node do not resolve `*.localhost`; the API honours it only while `DEV_STORE_SLUG` is set, which `config` forces to `undefined` in production. The frontends send it from `lib/api.ts` / `lib/api/client.ts` under the same condition. The bare fallback — no header and no slug in the host — applies only to a **loopback** hostname, so a real hostname is resolved as a custom domain even in development.

A **custom domain** carries no slug, so `company-api`'s verified-domain table is the only authority for it, and it is connected for one **surface**: `storefront_custom` and `platform_subdomain` serve the storefront, `admin_custom` serves the panel. A hostname asking for the other surface's routes resolves to nothing and gets the same `STORE_NOT_FOUND` an unconnected hostname gets — so a store's other addresses cannot be enumerated one request at a time. Platform hostnames are exempt (`api.<slug>.company.com` serves both); there the surfaces are separated by **origin** instead, which is what `plugins/security.ts` enforces for CORS and for the CSRF origin check on every write. That check is per surface too: a storefront origin is refused the admin API even for its own store. `lib/tenant-cache.ts` on the company side deletes the client platform's cached record whenever a domain, a suspension or an expiry changes the answer, over the Redis both platforms share — so the change lands at once instead of at the end of the 60-second TTL, and the trust direction stays one-way.

### One application, two halves

`company-web` is the public site **and** the signed-in client dashboard — one Next app, one design system, one API. Marketing pages live in the `(marketing)` route group and stay statically rendered; everything under `/dashboard` is the authenticated client area, grouped as `dashboard/(shell)`. `src/middleware.ts` guards `/dashboard/*` on the presence of the session cookie only — real authorisation is the API's job on every request.

**Billing comes before everything else.** `/dashboard/plans` is the first entry under the overview, and until its bill has settled the rest of the dashboard is locked: `Invoices` renders `components/dashboard/billing-required.tsx` instead of itself and is shown with a padlock in the sidebar, and every other page carries the banner from the same file. **`My Store` is the one exception and is never locked** — it is the thing being bought, so it shows the whole setup (the hero, the four steps, the pieces it will build) unpaid, and refuses only `Start Setup`, which opens `BillingFirstDialog` in `store-setup-wizard.tsx` naming what is outstanding and how much it is. A padlock there taught nobody what they were paying for; the API refuses every setup call regardless, so nothing rests on the UI. One helper derives that — `lib/billing-gate.ts` — and the layout, the shell and each gated page all read it rather than re-deriving it. Support, Security and Settings stay open on purpose: locking someone out of those because a payment has not landed makes a billing problem unfixable by the person who has it.

**Two dashboard pages own everything about getting a store**: `/dashboard/plans` sets up billing and pays the bill, and `/dashboard/store` builds the store and is its home afterwards. Website setup, admin panel setup and domains used to be sidebar entries of their own; they are steps of the store page's wizard now, and `next.config.ts` redirects the old paths. Signing in always lands on `/dashboard`, which reads what exists and renders one of three states — no plan (a "launch your store" card), plan paid but no store yet, or a live store (plan/trial/store/invoice cards, quick actions, getting-started checklist) — each pointing at whichever of those two pages has the next thing to do. The `Apps` switcher in the header is the only route across to the storefront and the store admin panel, and it only offers them once the store is actually ready.

The dashboard manages the SaaS account: plan, trial, subscription, billing, invoices, store status, domains, support, security. Products, orders, inventory, customers and store design belong to `client-admin` and must never appear here.

The signed-in area used to live at `/account`; `next.config.ts` keeps permanent redirects from every old path.

### Buying a plan and getting a store

Served from `company-api/src/modules/client/onboarding.routes.ts`. The plan is bought on `/dashboard/plans`; the store is built by the wizard in `components/dashboard/store-setup-wizard.tsx`, behind the **Start Setup** button on `/dashboard/store`.

**The free trial is a plan** (`plans.is_trial`, seeded as `free-trial`, priced 0.00 on both cycles, premium feature set), not a checkbox on the paid ones — a database partial unique index allows exactly one such row, and disabling it is how the trial is switched off platform-wide. It is offered **once per account for life**: `client_accounts.trial_used_at` is stamped when it is chosen, and having ever settled a `purpose = 'subscription'` payment ends the offer too. `GET /onboarding` reports `trialOffer.available` and the billing page only draws the card when it is true, but the refusals that matter are the API's — `/onboarding/plan`, `/subscription/change` and `/payments/checkout` all reject the trial plan with `TRIAL_ALREADY_USED`, and `/subscription/reactivate` refuses to renew one. It does not convert: when it expires `trial-sweep.ts` pauses the store, and buying a plan is what brings it back.

1. **plan** (`POST /onboarding/plan`, from `/dashboard/plans`) — plan + billing cycle. This is where the `tenants` row is born, because the subscription, trial and payment all hang off it. Until the store is named it carries a placeholder slug (`pending-tnt…`, see `services/onboarding.ts`), which nothing provisions and which `/client/overview` and `/client/store` both refuse to return as a store.
2. **payment** (`POST /onboarding/payment`, same page, a second deliberate step so the bill is seen before it is paid) — a purchase is charged now; a trial completes a zero-amount authorisation instead (`payments.purpose = 'method_setup'`) so a card is on file before the store exists. **Every plan is billed, including the trial and a free plan** — `paymentRequirement` returns `required: true` whenever a subscription exists, and only the amount varies (`amount` is due today, `planPrice` is what it costs after a trial). A 0.00 bill still goes through the gateway and still leaves an invoice, so "the bill was paid" — the one fact everything downstream reads — is never quietly true. Only the signed webhook settles it, so the page polls `GET /onboarding` rather than trusting the gateway redirect. **Nothing in the dashboard works until this settles** — `/dashboard/store` can be read, but every setup call behind it is refused.
3. **website** (`POST /onboarding/website`, wizard step 1) — store name and the store address (platform subdomain, plus an optional custom domain if the plan allows).
4. **admin panel** (`POST /onboarding/admin-panel`, wizard step 2) — the panel's address and the **store admin panel login**. This stages the login and emails a 6-digit passcode to it; it builds nothing.
5. **passcode** (`POST /onboarding/admin-panel/verify`, wizard step 3) — confirms the address, sets `tenants.store_admin_email_verified_at`, and **this** is what queues provisioning. `/resend` re-issues on a 60-second cooldown.

`provisionIfComplete` refuses until the slug is real, a login is staged **and** that login is verified, which is why the store cannot be built by steps 3 and 4 alone: the admin address is the only way into the panel once it exists, so a typo has to be caught while the store is still a draft. The address must also be chosen during setup because the tenant database name and the store's cookie domain are both derived from it. `GET /onboarding` reports `website.configured`, `adminPanel.configured`, `adminPanel.verified` and `adminPanel.pendingVerification`, so a reload resumes on the step it left off.

After the store exists, the same page resets that panel password: `POST /client/store/admin-password/request` mails a code **to the store admin address** (never to the signed-in SaaS account), and `POST /client/store/admin-password/reset` takes the code and the new password together. `services/store-admin.ts` writes it into the tenant database and drops every open panel session; before provisioning it writes the staging column instead.

Currency, language, timezone, template, products — none of that is asked here. The owner sets it inside their own store admin panel. Business address/country/type are optional invoice details, filled in later at `/dashboard/settings` (`PUT /client/business`).

What is still outstanding is **derived from what exists** (`resolveOnboardingStep`), not read off `client_accounts.onboarding_step`; the column is a record of progress, and accounts created under the old five-step wizard resolve onto the current flow without a data migration.

### Provisioning

`company-api/src/services/provisioning.ts` runs seven recorded steps — `tenant_record → tenant_database → tenant_schema → store_configuration → store_admin → platform_subdomain → store_ready` — writing each to `provisioning_jobs.completed_steps` so a retry resumes instead of restarting. The trial clock starts only after provisioning succeeds. The store's single admin is created from the **login confirmed by passcode at the last setup step**: `tenants.store_admin_email` / `store_admin_password_hash` stage it, hashed on the company side with the same Argon2id parameters `client-api` verifies with, and the staged hash is cleared once the `store_admin` step completes so the live credential exists in one place only. Plaintext never crosses the boundary. Tenants provisioned before this step existed fall back to the client account's credential, which is what they were built with.

Both this and `services/store-admin.ts` reach the tenant databases through `db/tenant-connection.ts` — raw `pg`, one connection per operation, because the database name is only known at runtime. `db/client.ts` is the control database and is never used for a tenant.

The store admin login and the SaaS account login are now **independent**: changing or resetting one deliberately does not touch the other.

### Auth: three cookie families that never interoperate

| Cookie | Issued by | Guard |
| --- | --- | --- |
| `company_client_session` | company-api | `requireClient` / `requireVerifiedClient` |
| `company_admin_session` | company-api | `requireAdmin`, `requireAdminReauth` |
| `store_admin_session` | client-api | `requireStoreAdmin`, `requirePermission(key)`, `requireSuperAdmin` |

Sessions are opaque 32-byte tokens stored only as SHA-256. Partial/challenge sessions (`requireAdminPartial`, `store_admin_mfa`) satisfy **no** protected endpoint and are exchanged for a full session with the token rotated. `GET /session` endpoints are deliberately unguarded and return `{ authenticated: false }` rather than 401 — guarding them is what caused sign-in redirect loops. Sensitive mutations return `REAUTH_REQUIRED` when the last authentication is stale; the panels catch it, prompt, call `/reauth`, and retry once (`company-admin/src/components/admin/reauth-provider.tsx`).

The company admin's passcode is asked **once per browser**, not once per sign-in. Clearing it issues a `company_admin_device` cookie (opaque token, SHA-256 in Redis under `admin-device:*`, `ADMIN_TRUSTED_DEVICE_DAYS`, default 1); inside that window `POST /admin/login` returns `{ otpRequired: false }` and signs in on the password alone. The token is a second secret, never a credential — it is only consulted *after* the password verifies, the lookup fails closed if Redis is down, and a password change forgets every remembered browser. Signing out deliberately keeps the browser remembered; `POST /admin/logout { forgetDevice: true }` is the opt-out. `npx tsx scripts/verify-admin-trusted-device.ts` (24 checks) is the proof that none of this softens the password.

Store-admin permissions are enforced in Fastify per route, never by hiding buttons. `STORE_SUPER_ADMIN` holds everything implicitly and has **no** rows in `admin_user_permissions`, so a grants-table bug can never lock an owner out.

Singleton accounts are enforced by the database, not by code: a unique index on a constant column blocks a second `company_admin` row, and `store_admins_singleton_key` blocks a second store admin. No endpoint creates either.

### API and error conventions (both APIs)

Success is `{ data }` or `{ data, meta: { page, pageSize, total, totalPages } }`; frontends unwrap `data` in `lib/api.ts`. Errors are `{ code, message, requestId, details }` and never leak stack traces, SQL or configuration. Throw `AppError(ERROR_CODES.X, message, status)` from `lib/errors.ts` — add new codes there rather than inventing strings. Validate with `parseBody` / `parseQuery` / `parseParams` from `lib/http.ts`, which turn Zod issues into the per-field `details` map the forms render, and build responses with `ok` / `paginated` / `noContent`. Plugin registration order in `app.ts` is load-bearing: request-context → security → error-handler → (tenant) → auth → routes.

## Traps worth knowing

- **`client-api/drizzle/0000_*.sql` is hand-edited.** Company provisioning already created `store_settings`, `store_admins` and `platform_sync`, so 0000 uses `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` for those three to preserve the seeded owner row. Re-running `drizzle-kit generate` over it discards the edits and drops the owner — add a new migration instead.
- **`client-api`'s `drizzle.config.ts` points at one reference tenant database** (`DRIZZLE_REFERENCE_SLUG`, default `abc-fashion`) **on one shard** (`DRIZZLE_REFERENCE_SHARD`, default the first shard taking new stores). drizzle-kit reads the config synchronously, so it cannot go and find the store — if the reference store is not on the default shard, set both. There is no single app database on that side; `src/db/tenant-migrate.ts` applies migrations to each tenant on first use under a `pg_advisory_lock`.
- **The READMEs predate the current auth flow.** `company/README.md` and `company/company-admin/README.md` describe TOTP MFA with recovery codes for the company admin; migration `0003_drop_admin_mfa.sql` removed that. Company admin **and** company client sign-in now use emailed one-time codes (`POST /admin/otp/verify`, `/admin/otp/resend`, `/public/login/otp/verify`, `/public/login/otp/resend`; see `lib/otp.ts`). Store-admin MFA in `client-api` **is** still TOTP. Trust the code over the READMEs on auth.
- **`client-store` has two data-source flags, not one.** `NEXT_PUBLIC_DATA_SOURCE` drives the catalogue — products, categories, brands, config, CMS, search. `NEXT_PUBLIC_COMMERCE_SOURCE` drives customer accounts, orders, returns, checkout and review submission. **Both are now `live`**; they were split when only the first half existed, and the seam stays because it is what lets one half be developed against fixtures while the other is real. `src/lib/api/mock/` is imported only on a `mock` branch, so a `live` build bundles none of it. Cart, wishlist and compare are browser-local by design and answer to neither flag. Template keys are authoritative with **underscores** (`modern_shop`); the company side seeds hyphenated values and `normaliseTemplateKey()` translates on read.
- **`app/api/auth/[action]/route.ts` calls `fetch` directly, not `apiFetch`.** It has to: `apiFetch` returns the parsed body and discards the `Response`, so routing sign-in through it threw the API's `Set-Cookie` away. The symptom was not an error — login answered `200`, no session was stored, and `/account` bounced back to `/login`. Anything proxying a response whose **headers** matter has the same constraint.
- **A verification script must clear its own rate-limit keys.** `verify-commerce.ts` registers, signs in, tracks orders and requests returns several times in a few seconds, which is exactly what the limiter exists to stop. It calls `lib/rate-limit.ts#reset` for its own IP and test identities on start-up; without that the second run inside fifteen minutes fails on the limiter rather than on anything under test.
- **Bumping `COMMERCE_SCHEMA_VERSION` is part of adding a migration.** `db/tenant-migrate.ts` returns early on a version match *without opening the migrator*, so a new `drizzle/000N_*.sql` that does not come with a bump reaches no existing tenant and fails silently.
- **Cookie domain is per store**, scoped to `.<slug>.company.com`. Scoping to the platform root is refused in code, because it would offer one store's session to every other store's origin.
- **`client-admin/AGENTS.md`** is generated by `next dev` (Next.js 16 agent rules) and re-created if deleted; `client-admin/CLAUDE.md` just imports it.
- With `MAIL_DRIVER=log`, verification codes and reset links appear in the API log — that is how you read them locally.

## Where the detail lives

[company/README.md](company/README.md) has the frozen company-side API contract (every public/client/admin/webhook/internal route). [client/README.md](client/README.md) covers tenant resolution, store-admin auth and the template/theme matrix, plus the slice status table (slice 0 done; catalogue, orders, storefront pending). Per-app READMEs cover setup, routes and Docker.
