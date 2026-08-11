# company-web

Public SaaS website **and** the signed-in client dashboard — one application. Next.js 16 (App Router) ·
TypeScript · Tailwind CSS 4 · Radix primitives.

This app is a **pure API consumer**. It holds no database URL, no payment keys
and no tenant credentials — only `NEXT_PUBLIC_*` values reach it.

```bash
cp .env.example .env.local
npm install
npm run dev        # http://localhost:3000
```

`company-api` must be running for pricing, auth and the dashboard to work.
Marketing pages still render if the API is briefly unreachable — pricing shows an
explicit "unavailable" state rather than fabricated numbers.

---

## Routes

| Area        | Paths                                                                        |
| ----------- | ---------------------------------------------------------------------------- |
| Marketing   | `/` `/features` `/pricing` `/how-it-works` `/security` `/faq` `/contact` `/legal/[terms\|privacy\|refund]` |
| Auth        | `/register` `/sign-in` `/verify-email` `/forgot-password` `/reset-password`    |
| Dashboard   | `/dashboard` `/dashboard/store` `/dashboard/website` `/dashboard/admin-panel` `/dashboard/domains` `/dashboard/plans` `/dashboard/billing` `/dashboard/invoices` `/dashboard/support` `/dashboard/security` `/dashboard/settings` `/dashboard/activity` |
| SEO         | `/sitemap.xml` `/robots.txt` `/manifest.webmanifest` `/opengraph-image`        |

A plan chosen on the pricing page (`/register?plan=business&cycle=yearly`) is
carried through registration and **preselected** on `/dashboard/plans`.

**There is no signup wizard.** Every decision lives on the page that owns it:

- `/dashboard/plans` — pick a plan and pay. It unlocks when the gateway's signed
  webhook settles the payment, never on the redirect back.
- `/dashboard/website` — the store's name and the address customers shop at.
- `/dashboard/admin-panel` — the admin panel's address and the login that opens it.
- `/dashboard/store` — status, addresses and provisioning progress.

The two setup halves can be done in **either order**; the store is built when the
second one is saved. The sidebar is grouped (Store / Billing / Account) so the
two setups sit next to My Store and Domains.

Everything else about the store — currency, language, timezone, design, products —
is configured in the client admin panel the owner is handed at the end, not here.
Business address, country and type are optional invoice details on
`/dashboard/settings`.

Signing in always lands on `/dashboard`. It reads what exists and shows one of
three states — no plan, plan paid but no store yet, or a live store — each
pointing at whichever page has the next thing to do. The `Apps` switcher in the
header is the way across to the storefront and the store admin panel, and it only
offers them once the store is ready.

The dashboard manages the **SaaS account** — plan, trial, subscription, billing,
invoices, store status, domains, support, security. Products, orders, inventory,
customers and store design belong to `client-admin` and never appear here.

Route groups: `(marketing)` stays statically rendered, `(auth)` is the signed-out
flow, and `dashboard/(shell)` carries the sidebar. `src/middleware.ts` redirects
signed-out visitors away from
`/dashboard/*` — a routing convenience only, since real authorisation happens in
the API on every request and the session cookie is `HttpOnly`.

The signed-in area used to live at `/account`, and signup used to be a wizard at
`/onboarding`; `next.config.ts` keeps permanent redirects from every old path.

---

## Content policy

The marketing pages carry **no invented social proof** — no fictional customer
quotes, no brand logos we have no relationship with, no made-up customer counts
or star ratings. `VALUE_STATEMENTS` and `PLATFORM_GUARANTEES` in
`src/lib/content.ts` are non-attributed claims about what the product does.
Replace them with real, permissioned testimonials when you have them.

The platform ships **one** storefront design, so there is no template gallery and
no template picker. `StorefrontDesign` describes what a store owner can actually
customise. If the client platform ever ships multiple designs, that is the
component and the onboarding step to revisit.

## Design system

Tokens live in `src/app/globals.css`: one palette on `:root`, a full dark palette
on `.dark`, both mapped into Tailwind via `@theme inline`. `next-themes` sets the
class, so light and dark both work with no flash on first paint. Every colour is
defined in both palettes — nothing borrows a value from the host page.

UI primitives are in `src/components/ui/` (hand-written shadcn-style, no CLI
dependency). Wide tables scroll inside their own container so the page body never
scrolls sideways.

---

## Structure

```
src/
  app/           (marketing)/ (auth)/ dashboard/(shell)/
  components/    ui/ marketing/ dashboard/ auth/ theme/ brand/
  lib/           api (fetch wrapper), server-api, validation (Zod), content,
                 format, types, env
  middleware.ts
```

---

## Docker

```bash
docker build -t company-web \
  --build-arg NEXT_PUBLIC_API_URL=https://api.company.com \
  --build-arg NEXT_PUBLIC_PLATFORM_ROOT_DOMAIN=company.com .
docker run -p 3000:3000 company-web
```

`NEXT_PUBLIC_*` values are inlined at build time, so they must be passed as build
arguments — not only at runtime.
