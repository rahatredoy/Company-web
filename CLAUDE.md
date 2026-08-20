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
npx tsx scripts/verify-catalog.ts             # 41 checks: categories, brands, products
npx tsx scripts/verify-cursor-pagination.ts   # 88 checks: every admin list walked by cursor
npx tsx scripts/verify-detail-views.ts --password '…'   # 39 checks: every View panel's detail endpoint
npx tsx scripts/verify-edit-fields.ts --slug throwaway --password '…'   # 37 checks: every edit form's fields round-trip, sale window, banner destination and category icons included
npx tsx scripts/verify-product-insights.ts --password '…'   # 50 checks: adding a product, and the figures its screen reads
npx tsx scripts/verify-measure-selling.ts --password '…'   # 28 checks: selling by weight — the rate, the sizes, the floor, and the grams that actually move
npx tsx scripts/verify-storefront.ts --password '…'   # 44 checks: the public read path, shop-by-category block included
npx tsx scripts/verify-home-rotation.ts   # 18 checks: a lap of the homepage covers the whole catalogue
npx tsx scripts/verify-commerce.ts   --password '…'   # 55 checks: accounts, checkout, orders, returns, reviews
npx tsx scripts/verify-admin.ts      --password '…'   # 96 checks: every admin section, uploads included
npx tsx scripts/verify-schema.ts
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
npx tsx scripts/delete-tenant.ts --slug old-shop                      # dry run; --yes to go ahead
npx tsx scripts/delete-tenant.ts --all --keep e-comarch --yes         # drop every other store
```

**There is one store on the cluster** — `e-comarch`, which is what `DEV_STORE_SLUG` names and therefore what plain `localhost:3002`/`:3003` open. The client-side verify scripts all fall back to that slug, so none of them needs `--slug`. The cross-tenant isolation checks inside `verify-storefront.ts` and `verify-commerce.ts` need a **second** store to compare against and skip themselves without one; build a throwaway with `create-client.ts` and pass `--other <slug>` when that half matters. `delete-tenant.ts` removes a store's database and its control-plane rows together (the SaaS login survives unless `--with-account`), and refuses to do anything without `--yes` — a dropped tenant database is not recoverable from anywhere in this repo.

`verify-signup-flow.ts` creates a throwaway account, provisions a real tenant database, asserts the bill was required and settled at the right amount (0.00 on a trial) and left an invoice behind, asserts the store admin login is the one setup chose and confirmed by passcode (and that the SaaS password does *not* open the panel), resets that password and checks the new one took, asserts the free trial cannot be taken a second time, then drops both again — pass `--keep` to inspect the result. `verify-dashboard-states.ts` additionally needs **company-web running on 3000**: it renders `/dashboard` for an account with no plan, one that has paid but has no store, and one with a live store, and checks each screen says the right thing. `verify-admin-trusted-device.ts` plants a known passcode hash on its own challenge row rather than reading an inbox, and leaves the admin signed out of every session with every browser forgotten — do not run it while you are signed in to the panel.

`verify-slice0.ts` uses `node:http` rather than `fetch` on purpose — `fetch` drops a custom `Host` header, and the hostname is the entire tenant-identity mechanism. It follows `DEV_STORE_SLUG` and names that store in the `Host` header of every call, but its owner credential does **not** follow the slug — the defaults are the retired `abc-fashion` fixture's, so pass `--email`/`--password` for the store you are actually verifying. `verify-domain-routing.ts` does the same for connected custom domains: it plants verified `storefront_custom` and `admin_custom` rows on a `.test` hostname (DNS verification cannot be performed for a test domain, and everything downstream of that flag is what is under test), checks each resolves to its own store and its own surface only, checks an unverified and an unknown host resolve to nothing, and checks a removed domain stops resolving immediately rather than at the end of the cache TTL — then removes them again, unless `--keep`.

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

**All 23 sidebar destinations are built.** `client-api`'s admin modules are `dashboard`, `catalog`, `orders`, `customers`, `reviews`, `inventory`, `fulfilment` (shipping/returns/refunds), `marketing` (coupons/banners/newsletter/contact messages), `website` (design/homepage/pages/FAQs) and `settings` (settings/payment methods/attributes/reports); `client-admin` renders each. `app/(dashboard)/[...section]/page.tsx` is now a plain 404 — its "coming soon" branch became unreachable and was removed rather than left to rot.

There are two **screen endpoints** on either platform, and both are allowed to be: `GET /admin/dashboard?days=&granularity=` answers the whole home screen — KPI deltas against the previous window, a gap-free sales series, recent orders, best sellers, low stock — in one call, because eight panels over the same two tables would otherwise be eight round trips and eight chances for one slow query to hold up the render. Its shape follows the page and is not a resource contract.

**It is one call but not one failure.** Every panel is its own `sections.<name>`, returned as `{ ok: true, data }` or `{ ok: false, reason, message }` where `reason` is `forbidden` (the admin may not read it) or `failed` (its query broke) — always inside a 200, because the page rendered even if one card on it did not. `dashboard.view` opens the screen without widening what it may read, so a section is refused **by name** rather than blanked. The page mirrors that: a missing payload becomes an `unavailable` section for each panel so the shell, the range picker and the quick actions still render, and `components/admin/panel-boundary.tsx` wraps the chart because a client-side throw would otherwise reach the route's `error.tsx` and take the whole screen with it. Four states per panel — data, empty, refused, broken — and they must stay distinguishable: an owner told "no orders" when the truth was a dropped connection will go looking for orders that never left.

Three more things are load-bearing. The window is decided by **Postgres in the store's own timezone** (`store_settings.timezone`), so "the last 7 days" means seven of the shopkeeper's days and every panel is bound to the same three instants. The series is generated from a calendar and left-joined, so a day with no sales is a zero rather than a missing point that would close the gap and invent a trend. And top products falls back to lifetime `products.sold_count` when the window sold nothing, tagged `scope: 'all_time'` so the panel says which it is showing — that row carries no revenue, because `sold_count` counts units and what they were charged at is long gone.

`GET /admin/products/:id/insights?days=` is the second one, and answers the product screen's Overview tab: stock buckets and what the ledger says was received, restocked and written off; revenue, discount, refund and an *estimated* profit; per-variant stock and dispatch; the last fifty movements; a gap-free daily sales series; returns; wishlist, reviews and views. Three numbers on it look like each other and are not. `stock.sold` is `products.sold_count`, which moves **on dispatch and nowhere else**; `money.units` is what was *ordered* on orders that were neither cancelled nor failed, which is the only basis the revenue beside it can divide by; and per-variant `sold` comes from the ledger's `order_fulfilled` rows, because `sold_count` is only kept for the whole product. A shop with parcels still to pack sees the second exceed the first, and that is the truth rather than a discrepancy. **Profit is estimated and the field says so**: an order line snapshots what the customer paid and never what the unit cost the shop, so the only cost available is today's `product_variants.cost_price` applied to past sales. Discount and refund are each a line's **share** of an order-level figure, split by what it contributed to the subtotal — a coupon is applied to a basket, not to a product. Unlike the dashboard it is a plain 200-or-throw: the page has one subject, so a failure is the whole answer rather than one card, and `products/[id]/page.tsx` reads it with `serverGetOptional` so a broken aggregate costs the Overview tab and not the editor beneath it.

**A product can be sold by weight or volume, and that is a switch rather than a
product type.** `products.sell_by = 'measure'` turns the shelf price into a
**rate** — `pricing_measure` base units of it, 1000 for a per-kilo price — and
puts a size picker on the storefront card: 1kg / 500gm / 250gm / 100gm, with
"৳40 Per 1kg (Min. 350gm)" beside the price. Which products have it is entirely
the panel's decision (Details tab, under Pricing); a shop that never touches it
has exactly the catalogue it had.

Modelling each size as a **variant** was the obvious alternative and is wrong for
what this serves: a greengrocer does not stock a "500g cucumber", it stocks
cucumbers and weighs out what was asked for. That shape would give every
vegetable four SKUs, four `inventory_levels` rows and four prices to keep in
step, and it would count the shelf in packs that do not exist. So a measure
product keeps **one variant, one price and one stock pool**, and only how a
quantity is *read* changes. Pre-packed goods — a 12-egg box — are still variants,
which is what the mode being off means.

`lib/measure.ts` is the single authority, copied into both frontends
(`client-admin/src/lib/measure.ts`, `client-store/src/lib/commerce/measure.ts`)
under the same rule the sanitiser is: the panel has to price a size while the
owner types, and a card cannot ask the API what 500g costs forty times a page.
The API is still what charges.

Five things about it are load-bearing.

- **No quantity column changed.** `order_items.quantity`,
  `inventory_levels.available` and the whole ledger stay integers; for a measure
  product they count the **base unit** (grams, millilitres, pieces), so the
  `>= 0` CHECK constraints, returns, refunds and every report work untouched.
  Widening them to numeric was the alternative and would have put a rounding
  question into stock arithmetic that currently has none.
- **`quantity` and stock are different numbers.** A line of 2 × 500gm is a
  quantity of *two* and a *kilo* off the shelf. `stockUnitsOf` is the one place
  that multiplication is written, and reserve, release, dispatch and return
  restock all go through it — reserving the quantity would hold two grams of
  pumpkin, releasing the measure on an ordinary line would put back five hundred
  shirts.
- **`sold_count` deliberately does not follow it.** Stock moves in base units;
  `sold_count` moves by the line's quantity, because it is a *ranking* and grams
  are not comparable with shirts — counting the pumpkin's kilo as a thousand
  would put it above every product in the shop forever. What was actually
  weighed out is in the ledger.
- **A size's price is rounded once**, in `priceForMeasure`, and that figure is
  the line's unit price everywhere downstream. Deriving a per-gram rate and
  multiplying it up would round twice and let a kilo bought as ten hundred-gram
  lots cost a different amount from a kilo bought whole.
- **The minimum is a floor on the line's total, not on the option.** That is what
  lets a shop offer 100gm and still refuse to weigh out less than 350gm of it:
  the card opens the counter on four rather than hiding the option, and
  `resolveRequestedMeasure` refuses anything short — a size that is not on the
  list is refused too, never snapped to the nearest, because quietly selling
  250g to somebody who asked for 300g is the one thing a till must not do.

The picker itself is a plain `<select>` on the card (the platform's own wheel on
a phone, and nothing to get wrong forty times a page) and priced chips on the
product page, where there is width to compare them. Two sizes of one product are
**two basket lines** — `lineId` includes the measure — or picking 1kg after
500gm would silently re-price the earlier one. The store-wide default list lives
in `store_settings.preferences.measureOptions`, edited once on the Settings
screen, and `products.measure_options` being null is what defers to it.

`npx tsx scripts/verify-measure-selling.ts --password '…'` is the proof (28
checks): it prices a real product per kilo, buys 4 × 100gm through the public
checkout, and asserts the unit price is 4.00, the line is 16.00 and **400 grams**
came off a 40kg shelf — plus that an unlisted size and an under-minimum basket
are both refused, and that switching the mode off clears the rate rather than
leaving it to print.

**The sale window is the panel's, not just the schema's.**
`product_variants.sale_starts_at` / `sale_ends_at` were always enforced by
`storefront/service.ts#effectiveSale` — at checkout and on the product page —
and nothing in the admin panel could set either, which made every sale price
permanent from the moment it was typed. All three editing surfaces offer it now
(Details tab, Variants tab, Quick Edit), and `lib/local-datetime.ts` moves the
value in the **browser's** clock, because `<input type="datetime-local">` has no
timezone and the column does — rendering the ISO string straight into the box
would move a Dhaka evening sale by six hours.

**Wiring it exposed a half-finished feature and finished it.** `effectiveSale`
was applied on the product page and at checkout only; every *listing* read the
denormalised `products.sale_price_from`, which carries no window — so a card
could advertise a price the product page then refused. `service.ts` now exports
`liveSalePriceSql` (the sale a shopper can get right now) and
`liveSaleExistsSql` (its semi-join for filters), and the summary columns, the
`sale` filter, `effectivePriceSql`, search and the homepage `sale` source all
read them. **A window is checked in SQL at read time**, so a sale ends itself
rather than waiting for a sweep — and the four cache layers mean a page can be
at most its own TTL stale about it, which the 60-second edge bound already
covers. The `exists` form is deliberate: it is asked over every candidate row in
the catalogue, and it stops at the first matching variant.

**The Details tab writes more than the create panel asks for**, and the gap is
deliberate: `POST /products` has no `seoTitle`, `minOrderQuantity` or
merchandising flags, because none of them can be answered before the product
exists. The tab adds them on top of `payloadFrom` rather than inside it, since
that helper is shared with the create panel and reading a control it never
rendered would send a null for a field nobody was asked about. The **slug** is
there too and only there — a rename must never move a live storefront address,
so moving one is its own explicit act.

A product is edited across five tabs — details, variants, gallery, specifications, related — because each of the last four is written to the API as a **whole list**, and one Save posting all five would turn a rejected variant into a lost gallery edit. `GET /products/:id` returns `media`, `specifications`, `attributeValueIds` and `bundleProductIds` alongside the variants for the same reason: a full-replace endpoint is only safe to offer once the editor can read back the list it is about to replace. Only the gallery (`variant_id is null`) is returned from `product_media` — the product form's single image lives in the same table tied to the default variant, and returning both would show it twice and then delete it on the next gallery save.

**A variant added later is counted too.** `PUT /products/:id/variants` takes an
optional `stockQuantity` per line and, for a variant it is **creating**, writes
the `inventory_levels` row and the `initial` ledger row that `POST /products`
gives every variant it writes — so a shop adding a 500 g line beside the kilo it
already sells no longer gets a variant with no level row at all, which reads as
*never counted* and therefore as sellable without limit. It is ignored for a SKU
that already exists, and has to be: stock only ever moves by a ledgered delta
(`POST /inventory/adjust`), and a number typed into a list-replacing form would
be an absolute write with no movement behind it. The Variants tab shows the two
states apart for the same reason — an opening-stock box on a new row, and the
count plus an `Adjust` link to `/inventory` on an existing one — and
`GET /products/:id` returns `stock: null` against `stock: 0` so it can.

**Adding a product asks less than editing one.** The create panel is six sections — basic information, classification, media, pricing, inventory, variants — and nothing else, because merchandising flags and the four list-shaped tabs cannot be answered before the product exists. `POST /products` takes the whole thing in **one transaction**: the product, its variants (`variants[]` when the owner switched them on, otherwise the single one described by the top-level `sku`/`price`), an `inventory_levels` row per variant in the default warehouse, an `initial` ledger row for any opening quantity, the main picture and the gallery. `sku`/`price` are required *only* when `variants` is absent — a product created from a list has no single SKU of its own — and a variant that names no `costPrice` inherits the body's, so the form can ask for cost once. The level row is written even at zero, so a new variant reads as *tracked and empty* rather than as never counted. **`PATCH /products/:id` edits the default variant but recomputes `price_from` across the whole list**, because a variable product's shelf price is its cheapest sellable variant and copying the default's price over it would re-price the product every time anyone opened the details tab.

**`products.track_inventory` is a real switch, not a label.** Off means stock is still counted but never refuses a sale — made to order, digital, restocked faster than the panel is opened. It is **not** the same as having no `inventory_levels` rows, which means a shop that has never opened the inventory screens; both read as sellable, for different reasons, and `reserveStock`, `inStockSql`, `stockBandFor` and the product screen's badge all honour both. Those four have to agree exactly, or a product is offered by the listing and then denied by its own page. `products.video_url` is one optional clip kept beside the gallery rather than inside it: `product_media` can hold a `video` row, but the gallery is written back as a whole list of images, so a video in it would be dragged about as a thumbnail and dropped by the next save.

Every module follows the same shape: `preHandler: [app.requireStoreAdmin, app.requirePermission(k)]` on every route, module-local Zod through `parseBody`/`parseQuery`, `ok`/`listed`/`noContent`, `audit()` **after** the transaction commits, and `invalidateStorefrontOnWrite(app)` registered once per module that changes public data. On the UI side: async server component + `serverGetListed` for the first batch, `export const dynamic = 'force-dynamic'`, and writes through the browser `api.*` client inside a `'use client'` component — **there is no `serverPost`**. Radix `Select` contributes nothing to `FormData`, so forms use a plain `<select>`.

Rules worth knowing before changing any of it:

- **Status graphs are server-side.** `ORDER_TRANSITIONS` in `lib/constants.ts` — not the enum — decides what an order may become next, and returns and refunds have their own maps in `modules/fulfilment/`. The panel only renders `allowedTransitions`; the API re-checks, so a stale page gets a clear 409 rather than a bad write.
- **Stock only ever moves by a single conditional `UPDATE`**, and every movement writes an `inventory_transactions` row in the same transaction. The `>= 0` CHECK constraints are the backstop: an overdraw fails as `INSUFFICIENT_STOCK` (matched on SQLSTATE `23514`, because Drizzle wraps the driver error and the constraint name is on the `cause`, not the message).
- **`sold_count` moves on dispatch, nowhere else** — counting it at checkout would rank abandoned and cancelled orders as best sellers.
- **Deleting is often archiving**: a product that has sold, a coupon that has been claimed, a customer at all (there is no delete — order history points at them; blocking is the lever). A newsletter subscriber is marked unsubscribed rather than deleted, because a deleted row is one the next signup silently re-adds.
- **`pages.body_html` is sanitised on write** by `lib/sanitise.ts` — the storefront renders it as HTML trusting exactly that. It is a deliberate copy of `client-store/src/lib/sanitise-html.ts`, which runs again at render.
- **A policy page cannot be deleted** (`systemKey` set): the footer and checkout copy link to it, and removing one leaves dead links nobody looks for.
- **Currency cannot change once the store has taken an order.** Prices are decimals with no currency of their own, so switching the code re-labels every past total rather than converting it.
- **A store has exactly one admin**, enforced by `store_admins_singleton_key`. No endpoint creates one, so `/staff` explains that rather than offering an invite that the database would refuse.

### How a storefront read is answered

Four layers, and a request stops at the first one that can answer. The point of the arrangement is that the cheapest layer absorbs the most traffic, so the ones below it are sized for a fraction of the shop's actual load.

1. **The edge.** `lib/public-cache.ts` marks the public catalogue reads `Cache-Control: public, s-maxage=…, stale-while-revalidate=…`, so a CDN answers them without touching this API at all. **The route must be named in `PUBLIC_READS` to escape the `no-store` that `plugins/security.ts` applies by default** — an unlisted route stays private, which is the right way round given the failure is a shared cache handing one visitor another's response. Four conditions are re-checked per response: the route is listed, the reply sets no cookie, the status is 200, and the store was named by the hostname rather than by the dev-only `X-Store-Slug`.
2. **The browser, via ETag.** `@fastify/etag` puts a weak validator on every response; anything carrying a price has `max-age=0`, so a returning shopper revalidates and gets a 304 with no body rather than a fresh payload.
3. **Redis.** `lib/cache.ts#cached`, keyed by `tenantKey` so an entry can never be shared between two stores. The listing caches its **page and its facets apart** — facets do not depend on the page or the sort, so pages 2…40 of a filter combination reuse what page 1 paid for. `queryKey` in `lib/public-cache.ts` hashes the *parsed* filters, so `?brand=a&brand=b` and `?brand=b,a` are one entry.
4. **PostgreSQL**, with the partial and trigram indexes from `drizzle/0006_storefront_indexes.sql`.

Everything cached is under the `:storefront:` key scope, so `invalidateStorefrontOnWrite` drops all of it on any admin write. **The edge copy is the one nothing can purge**, which is why anything carrying a price or a stock badge gets a 60-second shared TTL and nothing longer. That is safe only because checkout recomputes every price and moves stock with a conditional `UPDATE`: a listing that is a minute stale sells out at the till as `INSUFFICIENT_STOCK` rather than overselling.

Responses are compressed (`@fastify/compress`, brotli then gzip, over 1 KB only). Brotli quality is **4, not the default 11** — 11 is for compressing once and serving forever, and costs ~100× the CPU for a few percent on a response built per request.

### Every list opens the record, not the shop

**View** in the store admin panel opens the row itself in a panel beside the
list. It used to open the storefront, which answers a different question: the
shop's product page shows a price, a picture and a description, and says nothing
about cost price, stock buckets, SKUs, or the variants that are switched off —
and more than half these lists (customers, refunds, subscribers, messages) have
no storefront page at all. The storefront link is still offered, under a `Store`
icon beside the eye and in each panel's footer, where it reads as one of the
things you can do with a row rather than as the meaning of "view".

Beside the list rather than on a route of its own, because **a virtualised list
has no scroll position the browser can restore** — navigating away to read one
row cost the reader their place in the list, and Escape now puts them back
exactly where they were.

Three pieces, all in `client-admin`. `components/admin/detail-sheet.tsx` is the
shell and the vocabulary (`DetailSection`, `DetailField`, `DetailTable`,
`DetailTotals`, `DetailId`, `DetailJson`); `hooks/use-detail.ts` reads the record
when the panel opens and caches it per id, and `useViewTarget` holds which row is
being shown. **One panel per list, not one per row** — a sheet per row would put
a Radix portal behind every row on screen and a virtualised list unmounts those
mid-scroll. The panels themselves are `<entity>-detail.tsx` beside their list.

The panels are **read-only on purpose**. Editing is what the edit panels and the
product tabs are for, and one surface that shows everything while writing some of
it makes the reader guess which fields are which.

Rules worth knowing before adding one:

- **A panel shows every column of its row**, including the ones no screen used
  to: an order's four stage timestamps and `inventory_released`, a product's
  `view_count` and `return_window_days`, a message's `ip_address`, a return's
  `reviewed_at`/`received_at`/`completed_at`, a coupon's redemption ledger.
  `scripts/verify-detail-views.ts` asserts field *presence*, not truthiness — a
  nullable column that came back null is correct and a column the handler forgot
  to select is not, and both read as falsy.
- **Two columns are credentials and are never sent.** `customers.password_hash`
  is reported as a `hasPassword` flag, `newsletter_subscribers.
  unsubscribe_token_hash` as `hasUnsubscribeToken` — sending the latter would
  hand whoever is reading the screen the power to unsubscribe that address.
  `customer_sessions.token_hash` is omitted the same way. The customer endpoint
  names its columns one by one rather than spreading the table, so a column added
  later cannot ride along; the verify script checks all three.
- **The lockout columns are not credentials and are returned.**
  `failed_login_count` and `locked_until` are what answer "why can this person
  not sign in", which is the most common thing a shop is asked and could not
  otherwise answer.
- **A list row that already carries every column gets no fetch.** Brands and
  categories read their whole set with the page, so `BrandDetail` and
  `CategoryDetail` render from the row and open instantly. Everything else uses
  `useDetail`.
- **The storefront's own routes are singular** — `/product/<slug>`,
  `/category/<slug>`, `/brand/<slug>`, `/page/<slug>`. Two "View in store" links
  (`product-actions.tsx`, `product-overview.tsx`) had been written `/products/`
  and 404'd; `client-store/next.config.ts` redirects the policy paths and
  `/order/success/*` and nothing else, so a plural guess just fails.
- **`GET /inventory/:id` takes the `inventory_levels` id** — what the list row
  carries — and deliberately *not* the same `:id` as
  `/inventory/:id/transactions`, which is keyed by **variant** because the ledger
  spans warehouses. The two are documented rather than reconciled; the level
  endpoint returns its own warehouse-scoped copy of the movements so the panel
  needs one call.

### Lists are scrolled, not paged

Every list in the store admin panel is one scrolling table. There are no page
numbers anywhere in it, and the rows the reader is not looking at are neither
fetched nor in the DOM.

**The API pages by keyset, not by offset.** `OFFSET n` makes PostgreSQL walk and
discard the n rows in front of the one being asked for, so the fortieth batch of
a scroll costs forty times the first — and a scroll asks for late batches far
more often than a pager ever did. `lib/keyset.ts` builds a lexicographic *seek*
instead (`WHERE (sort_col, id) > (…)`, unrolled rather than written as a row
constructor because these lists mix ascending and descending keys), which an
index answers directly: every batch costs the same.

It also fixed something offset paging could not. **Every keyset ends in the
primary key**, which makes the order total. That is a correctness requirement,
not tidiness: a list ordered only by `created_at` has no defined order between
two rows sharing a timestamp, so a row on a batch boundary could be sent twice
and its neighbour never — which is exactly what the old `ORDER BY created_at`
lists did, silently. Two nullable sort keys were the same bug in another form:
`price_from` is nullable and `anything < NULL` is NULL, so sorting products by
price would have dropped every unpriced one after the first batch (it is
coalesced now), and inventory's tie-break used the nullable `sku` (it is the
level's id now). `scripts/verify-cursor-pagination.ts` is the proof: it walks
each list in batches of three and asserts the ids match a single large read,
exactly, in order.

**The count is paid for once.** `meta.total` is returned only on a batch asked
for *without* a cursor — the first one — because the count is the half of a list
read that cannot stop at `pageSize`. `useInfiniteList` keeps that first answer;
`InfiniteTable`'s footer is what the pager used to be, minus the numbers.

`page`/`pageSize` still work as an offset on every one of these endpoints. That
is deliberate: `serverGetAll` reads reference lists that way, and it means an
endpoint's contract did not narrow.

On the panel side, three pieces: `hooks/use-infinite-list.ts` (appends batches by
cursor; **does not own the first batch**, which stays the server's so a
`router.refresh()` after a write is what updates it), `components/admin/
infinite-table.tsx` (`InfiniteTable` for tables, `InfiniteStack` for the two card
lists) and `components/admin/lazy-image.tsx`.

Three things about the table are load-bearing rather than cosmetic. **It scrolls,
not the page** — the virtualiser needs a bounded container, and keeping it here
is what makes the sticky header work without a per-screen offset. **`table-layout:
fixed` with a `<colgroup>`** — a virtualised table contains only the rows on
screen, so an `auto` layout would resize its columns on every scroll as different
content came into view; that is why columns are declared as data (`Column<T>[]`)
with explicit widths rather than as JSX. And the next batch is asked for when the
last *rendered* row is within eight of the end, rather than by a sentinel element:
a sentinel inside a `<tbody>` is not a row, and the table would have to lie about
its column count to hold one.

`dense` is opt-in and the products list is what takes it. Padding is what
separates one single-line row from the next, but a row whose cells already carry
two lines has that separation from its own content — there the space is only
whitespace, and it costs the reader rows. That list stacks a second line into
five of its columns (brand under category, margin under price, reserved and
incoming under the stock count, rating under units sold, the date added under
the last edit), which is how it shows roughly twice as much per product without
growing wider than the screen it is read on.

**`BATCH_SIZE` lives in `lib/list.ts`, not beside the hook.** A value exported
from a `'use client'` module and imported by a server component is not that value
— it is a client reference the bundler substitutes — so `pageSize=[object Object]`
reached the API and every list 422'd. That module carries no directive on purpose.

Two screens are exceptions to the fetching, not to the rendering. Categories and
brands still read their whole set in one go, because a drag reorder renumbers the
real list and the category tree cannot be batched without cutting a family in
half. They render through the same virtualised table (the tree flattened to its
open rows), so they lost their pagers along with everything else.

### Two caches sit in process, not in Redis

Redis is shared between both platforms and is usually not local to either, so a round trip to it is the largest fixed cost in a request. Two values are read on literally every request and are held in the API process as well:

- **The tenant record** (`lib/company-client.ts`). Held 3 seconds. `company-api/src/lib/tenant-cache.ts` **publishes** every key it deletes on `tenant:v2:invalidate`, and `subscribeToInvalidations` clears it — so a suspension, an expiry or a domain change still lands at once and the TTL is only the backstop for a dropped message. The channel name is copied into both files on purpose; change them together.
- **The store currency** (`modules/storefront/service.ts`). Held 5 seconds. It is part of every catalogue cache key, so it cannot be fetched alongside the listing it keys — and it is frozen for the life of a trading store anyway.

`/health` is on the rate limiter's `allowList` for the same reason: a liveness probe that depends on a remote Redis fails when Redis blips and takes healthy instances out of rotation.

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

**A card can add to the basket, and a card with options asks first.** A shopper
filling a basket with everyday things was made to open a product page per item
and lose their place in the listing on the way back, so `components/commerce/
quick-add.tsx` is a `+` on the card itself — a client island beside
`WishlistButton`, for the same reason that one is: the card is rendered a hundred
times on a listing and turning it into client JavaScript would ship its markup
twice.

**What it adds is a variant, never a product**, since the price and the stock a
checkout reserves both live there. So `ProductSummary` carries
`defaultVariantId`, `minOrderQuantity` and `maxOrderQuantity` — a `simple`
product owns exactly one variant, which makes a one-click add cost no request at
all, and the quantity bounds are what stop a "sold in threes" product reaching
the basket as one. The id comes from a correlated subquery in
`productBaseColumns` rather than a join, because a join to the default variant
would multiply the row set of every listing that reads those columns.

A product that comes in sizes — 1 kg, 500 g, 250 g — has no single answer, so the
button opens `quick-add-dialog.tsx` instead of guessing one: adding the default
weight because it was cheapest to do so is how somebody pays for a kilo of what
they wanted a hundred grams of. The dialog renders **`VariantSelector`, the
product page's own component**, so which combinations exist and which are in
stock is decided in one place; it reads `app/api/products/[slug]/options/route.ts`
— a route handler, not a Server Action, because the panel can be closed again
before the answer arrives and wants an `AbortController` (the same trade-off
`api/search/suggest` documents). That handler is a **narrowing proxy** over the
public product detail: it drops the description, specifications and reviews a
picker never draws, and sends the variants whole so the shared selector keeps
working.

**Once a product is in the basket the button becomes the count.** It used to
flash a tick for 1.8 seconds and go back to a plus, which answered "did that
work" and nothing else — a shopper who scrolled past and came back, or reloaded,
saw an untouched plus over a product they had already put two of in the basket,
and the only screen that disagreed was the basket. `QuickAdd` now renders the
same `− n +` pill `MeasureAdd` always did for a product sold by weight, **read
from the basket rather than from a timer**, so it survives a reload, agrees with
the header's count, and answers *which* products are in there and *how many*
without leaving the listing. Both states are anchored bottom-right, so the plus
does not move under the finger aiming at it, and stepping below
`minOrderQuantity` **removes the line** rather than clamping — the minimum is
sometimes more than one, and clamping would leave the shopper unable to undo the
add from the card they made it on.

Only a **single** line is stepped. A card standing for both a 1 kg line and a
250 g line has no honest answer to which of the two minus should take from, so a
product with more than one line in the basket keeps the plus and its picker — a
size is always chosen where the sizes are named — and carries a small total badge
instead, which is what stops the card claiming the basket is empty. Nothing
special happens on the server render: the cart's `serverSnapshot` is empty, so
the first paint is the plain plus and `useSyncExternalStore` swaps in the stepper
on hydration.

**Checkout sits between the two.** `optionalCustomer` attaches a shopper when one is signed in and says nothing when there is not, because requiring an account in order to buy something is how a shop loses the sale. The request carries **ids and quantities and no money at all** — price, sale window, coupon, shipping and totals are every one of them recomputed from the tenant database, because the basket lives in `localStorage` and anything priced there is a number the customer could have edited. Stock moves `available → reserved` with a **single conditional `UPDATE`**, never read-modify-write; the `>= 0` CHECK constraints are what turn a race for the last unit into `INSUFFICIENT_STOCK` rather than an oversell.

Two things worth knowing. `GET /account/me` answers **404, not 401**, when signed out — the storefront's account layout redirects on a null customer and a 401 would throw instead. And a guest who has just paid is let back onto their own receipt by `store_guest_orders`, an opaque cookie whose SHA-256 keys a Redis set of the order numbers that browser placed; without it `/checkout/success/<n>` would 401 the customer who had just bought something.

Payment is **COD plus a `mock` gateway** (`services`… `payments.routes.ts`), both live in the `payment_provider` enum and neither needing credentials. Stripe and SSLCommerz are adapter seams. The mock gateway confirms over GET because a form POST from the API's own origin would be refused by the CSRF hook; a real gateway posts a signed webhook to the tenant-exempt `/api/v1/webhooks` prefix instead, where `payment_webhook_events`' unique `(provider, event_id)` makes a redelivery a no-op.

Three things worth knowing. `surfaceOf` in `lib/urls.ts` already reads every path that is not `/api/v1/admin` as the storefront, so these routes inherit the storefront's CORS origins and are refused to an admin-panel origin without naming themselves in `plugins/security.ts` — which is why they are registered as their own prefix in `app.ts` rather than beside the admin routes. `lib/cache.ts#invalidateStorefrontOnWrite` is an `onResponse` hook registered by `modules/catalog/routes.ts`, not a call in each handler, because a rule that says "remember to invalidate" holds only until somebody adds a route; without it a save takes up to five minutes to reach the shop. And a homepage section that names a `source` (`new_arrivals`, `featured`, `best_selling`, `sale`, `recommended`, `discover`) has its `productIds` resolved server-side in `home.routes.ts` — the storefront renders product blocks from an explicit id list, which can never contain a product that did not exist when the section was saved.

**The homepage works through the catalogue instead of showing the top of it.** A shop with two hundred products and half a dozen product blocks used to show about forty of them and always the same forty: "best sellers" is the same twelve every day by definition, and a product nobody has bought or reviewed yet answered none of the blocks' questions and so reached the front page never. `resolveSource` moves each block's window by its own width once an hour (`ROTATION_SECONDS`, phased per store by a hash of the tenant reference so the platform does not turn over on one stroke), wrapping at the end of the eligible set — so a lap shows every eligible product exactly once rather than sampling them. `scripts/verify-home-rotation.ts` is the proof, and it needs `resolveSource`, `withResolvedProducts`, `resolveShowcase` and `rotationIndex` exported because a lap is the better part of a day and nothing outside the process can move the clock. **The clock itself lives in `storefront/service.ts`** — `ROTATION_SECONDS`, `rotationIndex` and `rotateWindow` — rather than beside either caller, because the homepage's rails and the category panels' aisles have to turn on the same stroke; two clocks would read as the page rebuilding itself twice.

**Rotation may never outrun what the heading claims**, which is what `ROTATION_POOL` records. `featured`, `sale`, `recommended` and `discover` are *predicates* — every matching row is equally entitled to the heading above it, so the window walks the whole eligible set. `best_selling` is a *ranking*, true only near the top, so it rotates within a pool of 60 and no further. `new_arrivals` does not rotate at all: it means "the latest", and the thirteenth-newest product is not that however it is presented. The `deal` block passes `PINNED` for the same reason — "Deal of the Day" is a superlative about one product, and the second-deepest discount under it is not a fresher deal but a wrong one.

**Banners.** A banner's destination is picked, not typed: `banners.category_id`
names a category or a subcategory, and `resolveBanners` sends the storefront
`/category/<slug>` read from the category itself — so renaming a slug moves every
banner pointing at it instead of leaving a homepage full of links to a page that
no longer answers. It **outranks `linkUrl`**, which stays for the addresses that
are not a category (`/sale`, a landing page), and the panel asks which kind the
destination is before offering either control, so the two can never be set
against each other. An **inactive** category resolves to no link rather than to
its own hidden page: the artwork still runs as an announcement, which is what
`PromoBannerCard` renders a destination-less banner as. The FK is `set null`
(migration `0009`) — it was `cascade` while nothing read the column, which once
wired would have meant tidying the catalogue silently deleted artwork.

Where they appear is a **homepage block naming a placement**, not artwork saved
into the page: a `banner` or `promo_trio` section carrying `config.bannerPosition`
is filled in by `resolveBanners` at read time, so a campaign starts and finishes
on its own dates with nobody opening the homepage screen. `banner` also reads
`config.columns` and `config.ratio`; `{ columns: 1, ratio: 'strip' }` is the wide
advertising break between two product rows, and `PromoBannerCard` drops the scrim
and the text column entirely for a banner with no copy, because artwork with the
offer set into it is the message rather than the backdrop to one. New stores are
seeded with two such blocks, **empty** — invisible until the owner adds a banner,
then live without a second visit here; `scripts/add-promo-banner-blocks.ts` gives
them to a store built before that (idempotent, additive, `--max`, dry until
`--yes`, and it never puts a break where one already follows).

**`discover` is the source that guarantees the rest of the shop is seen.** It asks the catalogue no question at all — every published product, ordered by primary key alone, which is arbitrary and, crucially, the *same* arbitrary every hour, so the walk is a walk rather than a re-deal. New stores are seeded with one such block (`store-content-seed.ts`); `scripts/add-discover-block.ts` gives one to a store built before it existed (idempotent, additive, dry until `--yes`).

**The rotation is part of the Redis key** (`…:storefront:home:r<n>`, and `…:storefront:category-showcase:r<n>:<query>` for the department panels). It has to be: an entry keyed on the store alone would hold the previous hour's window for whatever was left of its TTL, so the turn would land anywhere in a two-minute smear depending on when the last visitor arrived. Keyed this way the flip is exact and the spent hour expires unread, while `invalidateTenantCache` still drops every rotation because it matches the whole `:storefront:` prefix. The rotation interval cannot usefully drop near the cache TTLs — 120s in Redis, 120s at the edge, 120s of storefront ISR — or it would turn mostly inside a cache nobody can see.

**The homepage shows the whole shop, and three blocks are what make that true.**
Everything else on it is a *sample*: the rail lists departments and stops there,
and every product block asks a question — the newest, the best selling, a
different twelve every hour — so a shopper who wants an aisle or a particular
product has to already know that `/category/<slug>` and `/shop` exist. Each of
the three is an ordinary section type carrying one `config` key, so nothing new
had to reach the enum, the migrations or any tenant database.

- **`category_grid` + `showProducts`** is what a new store is seeded with, and
  it draws the shop rather than its filing system: one department per block, and
  under its header **a row of products per aisle** — three aisles stacked, each a
  rail with its own heading and `View all`, with every aisle in the department
  offered as a chip above them. A shopper recognises a phone on sight and has to
  *read* the word Smartphones, which is the whole reason it replaced the directory
  below on the seeded homepage.

  **The blocks are spread down the page, not stacked.** Four panels between two
  banners is a catalogue dump wearing a homepage's clothes, and it buries whatever
  follows — so a seeded homepage runs department, promo, rail, department, and
  every product on the page arrives beside something unlike it. `config.offset`
  is what keeps two blocks from drawing the same department, and it is an **offset
  rather than a category id** because these blocks are seeded on the day a store
  has no categories at all: an id would have to be filled in by hand later, an
  offset fills itself in as the owner builds the shop, and a block whose
  department does not exist renders nothing. `scripts/distribute-category-blocks.
  ts` gives that shape to a homepage built before it (dry until `--yes`; it
  rewrites every `sort_order` as 10, 20, 30 … because inserting between two
  adjacent orders is not otherwise possible, and it removes the `feed` block
  unless `--keep-feed`).

  **Stacked rows, not a tab bar.** Tabs show one aisle and hide the rest behind a
  click, which is the directory's problem in a smaller frame — the shopper has to
  already know which aisle they want. Three rows of eight is one panel
  (`SHOWCASE_DEFAULTS`), each a **rail rather than a grid** so an aisle costs the
  height of one row, and the aisles past the third are the chips in the header —
  **links, not tabs**, so they need no JavaScript and stay crawlable. An aisle
  with no products gets no chip: a link to an empty listing is a dead end wearing
  the same clothes as a live one.

  It is **one read for the block**, `GET /storefront/categories/showcase`
  (`taxonomy.routes.ts`), and it returns **ids only** — `{ categoryId, rows: [{
  categoryId, productIds }] }`. Asking the listing endpoint per aisle instead
  would have been a dozen HTTP calls, a dozen pairs of Redis keys and a dozen
  facet builds — five aggregates over a whole subtree each — for a block that
  renders no filter panel. Here every aisle is ranked in **one query**, a
  `row_number()` partitioned by a `values` list mapping category → row, which is
  also why a three-deep subtree costs nothing extra. The ids are then resolved
  through `primeProductSummaries`, the same batched `?ids=` read the rest of the
  homepage uses, so a product already on the page is not fetched twice — and the
  cached showcase entry holds no price, which is what lets it keep the homepage's
  window rather than a listing's.

  Names, pictures and counts come from the **category tree this render already
  holds**, never from the showcase response, so a department cannot be described
  one way in the rail and another way here; the two are cached apart, and a row
  whose category is missing from the tree is dropped rather than drawn nameless.
  An empty aisle is dropped **before** the row window is taken, so a department
  whose first three aisles are bare still shows three rows of products instead of
  three headings over nothing. The chips are **links, not tabs** — every aisle
  that has products, previewed or not, which is what makes the panel a complete
  answer about the department, needs no JavaScript and stays crawlable. Defaults
  are six departments, three rows, eight products (`SHOWCASE_DEFAULTS` in
  `section-renderer.tsx`); every one of them is also a bound on the query, so the
  endpoint caps what a caller may ask for.

  **The panel rotates too, on two clocks.** Three rows of a six-aisle department
  is half the department, and it was always the same half — a shop's Cameras and
  Printers aisles could not be reached from its homepage at all, and an aisle of
  thirty products showed the same eight of them for ever. Both windows walk now,
  on the same `rotationIndex` the homepage's rails use so a page turns on one
  stroke rather than two: `rotateWindow` moves which aisles are previewed, and a
  window expressed as arithmetic on `row_number()`/`count(*) over` — in the pass
  that was already ranking them, so it costs no second query — moves which
  products each aisle shows. Nothing here is capped the way `best_selling` is,
  because the heading over a row is an aisle's *name* and every product filed
  under it is equally entitled to be there.

  **The two clocks must not be the same clock**, and that is the subtle part. An
  aisle that comes round every three hours, holding twenty-four products shown
  eight at a time, would meet a product window that had advanced by exactly
  3 × 8 = 24 — back where it started — and show the same eight for ever, which is
  the bug the rotation exists to remove reappearing inside its own fix. So a
  bucket carries **its own product clock**, turning once per lap of its
  department's aisles rather than once per hour: a lap's worth of consecutive
  turns advances the aisle window by `rows × lap ≥ aisles`, and a contiguous
  window moved that far has covered the whole ring, so every aisle is drawn at
  least once while the product window holds still. The lap is measured on the
  *candidate* aisles, which are known before the query, rather than the stocked
  ones, which are not — too long is the safe direction, since it delays a turn
  and cannot skip one.

  `MAX_AISLES` (24) is therefore the length of the lap as well as the width of
  the candidate set: a department with more aisles than that previews the first
  twenty-four and rotates within them, and the rest stay reachable by their chips
  and by the department's own page. `resolveShowcase` is exported for the reason
  `resolveSource` is — `scripts/verify-home-rotation.ts` walks a whole lap and
  asserts that it previews every stocked aisle and, for the deepest one, every
  product in it. That cannot be checked over HTTP: a caller cannot move the clock.
- **`category_grid` + `showSubcategories`** renders as a *directory* rather than
  a row of tiles: every department printed with its subcategories under it, each
  of them a link. It is deliberately not truncated — the block's whole claim is
  that the list is complete, and a "+4 more" is the rail again. `Category.
  children` is already in the categories payload, so the depth costs no second
  call; it stops at grandchildren, because a fourth level turns a homepage panel
  into a file explorer. Still rendered for a store that asks for it — the panel's
  *How it lists* control picks between the three modes, and
  `scripts/show-products-under-categories.ts` is what moved the stores seeded
  before the products mode existed (idempotent, dry until `--yes`; it rewrites
  the two keys and leaves a hand-edited `categoryIds`, `limit`, `rows` or
  `perRow` alone).
- **`product_grid` / `product_carousel` + `feed`** is the whole catalogue,
  fetched a page at a time from the ordinary listing endpoint behind a "Load
  more" button. **No longer seeded** — it was the longest and least specific
  thing on the page, and it existed because nothing else showed the shop rather
  than answering a question about it, which is what the department panels do now,
  aisle by aisle instead of as one undifferentiated wall. Still rendered for a
  store that adds one from the panel, and `add-catalog-blocks.ts` still offers it
  to an older store. It **cannot** be a longer rail: a section's products are resolved
  into the homepage payload that four cache layers then hold, and `readLimit`
  caps that at 24 for exactly that reason. So the first batch is server-rendered
  by `CatalogFeedSection` and the rest arrives through the `loadCatalogPage`
  Server Action — an action rather than a route handler because it is neither
  cancellable nor worth an HTTP cache (`api/search/suggest/route.ts` documents
  the other side of that choice). `withResolvedProducts` returns a `feed` block
  untouched: resolving ids for it would be invisible waste, twenty-four products
  fetched to render none of them. The client component is **keyed on a
  fingerprint of the first batch**, so a batch that has moved on remounts the
  feed instead of appending pages of a list that no longer exists.

New stores are seeded with four department panels and no feed
(`store-content-seed.ts`); `scripts/distribute-category-blocks.ts` is what gives
an existing homepage the same shape, and `scripts/add-catalog-blocks.ts` remains
for the older pair (idempotent, additive, dry until `--yes`, and it adds only
whichever of the two is missing).

**One category block per homepage — except the directory.** `category_grid`
otherwise renders as the same circular rail `category_circle` does on these
templates, so a grid further down the page is the top rail drawn twice — which a
visitor reads as having scrolled back up by accident.
`scripts/seed-demo-store.ts` used to add two grids under it and no longer does.
`scripts/drop-duplicate-category-blocks.ts` clears the stores it already built —
dry by default, and it refuses to remove a grid unless a circle block survives
it, since a homepage whose only category block is a grid needs that grid. It
also leaves a grid carrying `showProducts` **or** `showSubcategories` alone:
either of those is a different answer from the rail's, not a second copy of it.

**A phone is given the desktop layout, and product grids are the one exception.**
`NEXT_PUBLIC_MOBILE_LAYOUT=desktop` (client-store, now the setting in use) hands a
phone the same 1280px layout viewport a monitor gets and lets the browser scale it
down — so the sidebar, the eight-across category row and the whole navigation all
survive and the design is identical everywhere. It is done in the **viewport meta
tag** (`generateViewport` in `app/layout.tsx`) because breakpoints answer to the
layout viewport, and CSS cannot change that.

What that costs is legibility, and the product grid is where it stops being
acceptable: six cards across 1280px is about 60px a card on a 400px screen. So on
a phone-sized screen — and only there — every product grid becomes a sideways-
scrolled rail exactly **two** cards wide, and the homepage rails drop from the
template's `carouselPerView` to the same two. Three pieces: `product-grid` at the
front of all six templates' `gridClassName`, `product-rail` on `ProductCarousel`,
and the rules in `globals.css` keyed on `html[data-phone-layout]`. Those rules are
**unlayered on purpose** — Tailwind's utilities sit in `@layer utilities`, and
unlayered CSS wins over every layer at any specificity, which is what lets one rule
override six different per-template `grid-cols-*` strings.

`data-phone-layout` is set by a synchronous inline script in `<head>`, not by a
media query, and it has to be: in this mode the phone's layout viewport is 1280px
too, so a phone and a monitor answer every width query identically. `screen`
describes the device instead, and the **short** edge is what is read so turning the
phone does not change the answer (`PHONE_SCREEN_MAX_WIDTH`, 600 — between the
widest phones and the narrowest tablets). Inline and in the head for the reason
`ThemeStyle` is, so the rail is a rail in the first frame; on `documentElement`, so
it is outside the tree React hydrates. With JavaScript off nothing is marked and
the phone gets the plain desktop grid. Body text is still scaled with the page, so
fine print is a pinch-zoom away — zoom is deliberately never disabled.

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

Success is `{ data }`, or `{ data, meta }` for a list. The **admin** lists are keyset-paginated — `meta: { pageSize, nextCursor, hasMore, total? }`, built by `listed()` — while the storefront's are still numbered (`{ page, pageSize, total, totalPages }`, built by `paginated()`); frontends unwrap `data` in `lib/api.ts`. See *Lists are scrolled, not paged* below. Errors are `{ code, message, requestId, details }` and never leak stack traces, SQL or configuration. Throw `AppError(ERROR_CODES.X, message, status)` from `lib/errors.ts` — add new codes there rather than inventing strings. Validate with `parseBody` / `parseQuery` / `parseParams` from `lib/http.ts`, which turn Zod issues into the per-field `details` map the forms render, and build responses with `ok` / `listed` / `paginated` / `noContent`. Plugin registration order in `app.ts` is load-bearing: request-context → security → error-handler → (tenant) → auth → routes.

## Traps worth knowing

- **`client-api/drizzle/0000_*.sql` is hand-edited.** Company provisioning already created `store_settings`, `store_admins` and `platform_sync`, so 0000 uses `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` for those three to preserve the seeded owner row. Re-running `drizzle-kit generate` over it discards the edits and drops the owner — add a new migration instead.
- **`client-api`'s `drizzle.config.ts` points at one reference tenant database** (`DRIZZLE_REFERENCE_SLUG`, set to `e-comarch`; the code falls back to `DEV_STORE_SLUG` then `abc-fashion`) **on one shard** (`DRIZZLE_REFERENCE_SHARD`, default the first shard taking new stores). drizzle-kit reads the config synchronously, so it cannot go and find the store — if the reference store is not on the default shard, set both. There is no single app database on that side; `src/db/tenant-migrate.ts` applies migrations to each tenant on first use under a `pg_advisory_lock`.
- **The READMEs predate the current auth flow.** `company/README.md` and `company/company-admin/README.md` describe TOTP MFA with recovery codes for the company admin; migration `0003_drop_admin_mfa.sql` removed that. Company admin **and** company client sign-in now use emailed one-time codes (`POST /admin/otp/verify`, `/admin/otp/resend`, `/public/login/otp/verify`, `/public/login/otp/resend`; see `lib/otp.ts`). Store-admin MFA in `client-api` **is** still TOTP. Trust the code over the READMEs on auth.
- **`client-store` has two data-source flags, not one.** `NEXT_PUBLIC_DATA_SOURCE` drives the catalogue — products, categories, brands, config, CMS, search. `NEXT_PUBLIC_COMMERCE_SOURCE` drives customer accounts, orders, returns, checkout and review submission. **Both are now `live`**; they were split when only the first half existed, and the seam stays because it is what lets one half be developed against fixtures while the other is real. `src/lib/api/mock/` is imported only on a `mock` branch, so a `live` build bundles none of it. Cart, wishlist and compare are browser-local by design and answer to neither flag. Template keys are authoritative with **underscores** (`modern_shop`); the company side seeds hyphenated values and `normaliseTemplateKey()` translates on read.
- **`app/api/auth/[action]/route.ts` calls `fetch` directly, not `apiFetch`.** It has to: `apiFetch` returns the parsed body and discards the `Response`, so routing sign-in through it threw the API's `Set-Cookie` away. The symptom was not an error — login answered `200`, no session was stored, and `/account` bounced back to `/login`. Anything proxying a response whose **headers** matter has the same constraint.
- **A verification script must clear its own rate-limit keys.** `verify-commerce.ts` registers, signs in, tracks orders and requests returns several times in a few seconds, which is exactly what the limiter exists to stop. It calls `lib/rate-limit.ts#reset` for its own IP and test identities on start-up; without that the second run inside fifteen minutes fails on the limiter rather than on anything under test.
- **A storefront route is `no-store` until it is named in `PUBLIC_READS`** (`client-api/src/lib/public-cache.ts`). That is deliberate — the list is the only thing standing between a private response and a shared cache — but it means a new *public* catalogue route is uncacheable at the edge, and silently so, until it is added. Never add one that reads a cookie.
- **A verification script that poisons the tenant cache must publish, not just write.** The API holds the record in process for three seconds, so `redis.setex(tenantCacheKey(slug), …)` on its own no longer reaches it and the check tests a store the server still believes is healthy. Call `publishTenantInvalidation([key])` after the write — and expect a round trip's delay before it lands, which is what `settle()` in `verify-slice0.ts` waits for.
- **Bumping `COMMERCE_SCHEMA_VERSION` is part of adding a migration.** `db/tenant-migrate.ts` returns early on a version match *without opening the migrator*, so a new `drizzle/000N_*.sql` that does not come with a bump reaches no existing tenant and fails silently.
- **Cookie domain is per store**, scoped to `.<slug>.company.com`. Scoping to the platform root is refused in code, because it would offer one store's session to every other store's origin.
- **`client-admin`'s CSP has to allow remote images.** `next.config.ts` sets `img-src 'self' data: blob: https:`, and the `https:` is load-bearing: product pictures live on the store's R2 public domain — a different hostname per deployment, and one this app is never told, since it holds no storage config and `NEXT_PUBLIC_API_URL` names the API, not the bucket. The product form also accepts any `https` URL an owner pastes. Tightening this back to `'self' data: blob:` silently turns every thumbnail in the panel — products, inventory, dashboard — into a placeholder icon, with nothing in the server log to say why.
- **`client-admin/AGENTS.md`** is generated by `next dev` (Next.js 16 agent rules) and re-created if deleted; `client-admin/CLAUDE.md` just imports it.
- **A write schema accepting a field does not mean the handler writes it.**
  `PUT /attributes/:id` took a `slug`, answered 200, and never set the column —
  so an attribute renamed from "Colour" to "Shade" kept filtering on `?colour=`
  forever, with nothing in the panel to say so. It writes the slug now, moving it
  only when the slug itself was sent, with a clash check that excludes the row.
  `scripts/verify-edit-fields.ts` exists because a silently-dropped field and a
  saved one look identical from the form: it sets each field an edit form offers
  and reads the record back.
- **Three coupon columns are declared and unread.** `coupons.scope` /
  `target_ids` / `is_stackable` are not consulted by `applyCoupon`. They are
  deliberately **not** on the edit forms: a control that sets a restriction
  nothing enforces is worse than no control, because the shop then believes a
  code is limited when it is not. Wire the enforcement first, then the field.
  `banners.category_id` used to be listed here and no longer is — it is the
  banner's **destination** now, wired end to end (see *Banners*), which is the
  order this rule asks for.
- **The storefront's category rail is fed from three places, and only one of
  them is on the category itself.** Which departments it lists is
  `categories.show_in_menu`; the picture beside one is `categories.icon_url`;
  the built-in glyph is `storefront_settings.header_configuration.categoryIcons`,
  a **slug**-keyed map edited on the panel's *Design* screen rather than in the
  category editor, because that is where the storefront looks it up. Moving a
  category's slug therefore leaves its glyph behind. The panel seeds its editor
  from the stored map rather than from the categories on screen, so saving the
  design never prunes an entry for a category it was not showing. The rail
  itself lists **every** top-level category and scrolls; it used to stop at ten
  and end on a `More Categories` link, which asked the reader to leave the page
  to find out what else was in the shop.
- With `MAIL_DRIVER=log`, verification codes and reset links appear in the API log — that is how you read them locally.

## Where the detail lives

[company/README.md](company/README.md) has the frozen company-side API contract (every public/client/admin/webhook/internal route). [client/README.md](client/README.md) covers tenant resolution, store-admin auth and the template/theme matrix, plus the slice status table (slice 0 done; catalogue, orders, storefront pending). Per-app READMEs cover setup, routes and Docker.
