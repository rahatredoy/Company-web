# Company Side — Multi-Tenant E-Commerce SaaS

Three **independently deployable** applications. Each folder is self-contained: its own
`package.json`, its own `node_modules`, its own `.env`, its own Dockerfile. Nothing is shared
through a monorepo workspace, so each one can be hosted on its own server/container.

| Folder                          | What it is                                   | Stack                      | Dev port |
| ------------------------------- | -------------------------------------------- | -------------------------- | -------- |
| [company-web](company-web/)     | Public SaaS website + client dashboard       | Next.js 16, TS, Tailwind 4 | 3000     |
| [company-admin](company-admin/) | Company super-admin panel (one fixed admin)  | Next.js 16, TS, Tailwind 4 | 3001     |
| [company-api](company-api/)     | Control-plane REST API + background worker   | Fastify 5, TS, Drizzle     | 4000     |

```
Visitors / Businesses ──▶ company-web (company.com)      ─┐
Company Admin ─────────▶ company-admin (admin.company.com)├──▶ company-api ──▶ company_control_db
                                                          ┘         │
                                                                    ├──▶ Redis (sessions, rate limit, BullMQ)
                                                                    └──▶ Provisioning ──▶ tenant_<slug>_db (one per client)
```

Both frontends are pure API consumers — they hold **no** database credentials, no payment
secrets and no tenant infrastructure configuration. Only `company-api` touches PostgreSQL.

---

## Scope of this phase

Built here: company website, client SaaS account area, company admin panel, company API,
`company_control_db`, registration, email verification, business onboarding, plans, the 7-day
free-trial plan (once per account), subscriptions, payments, invoices, simple provisioning, platform subdomain,
custom domain connection, support tickets, notifications, audit logs, security, settings.

Not built here (next phase, in `client/`): client storefront, client store admin panel,
commerce APIs (products, orders, inventory, customers, cart, wishlist, returns, refunds).
The company side only *creates* the tenant and its initial resources.

---

## Data ownership rule

`company_control_db` stores SaaS business data only — company admin, client accounts,
business profiles, tenants, plans, trials, subscriptions, payments, invoices, domains,
provisioning status, support, notifications, audit logs, settings.

It never stores client commerce data. That lives in each tenant's own database
(`tenant_abc_fashion_db`, …), created by provisioning and owned by the future client platform.

---

## Run order (local)

```bash
# 1. Backend — creates the database, runs migrations, seeds plans + the single admin
cd company-api && cp .env.example .env   # fill values
npm install && npm run db:bootstrap && npm run db:migrate && npm run db:seed
npm run dev            # http://localhost:4000
npm run worker         # second terminal — BullMQ jobs

# 2. Public website
cd company-web && cp .env.example .env.local
npm install && npm run dev               # http://localhost:3000

# 3. Admin panel
cd company-admin && cp .env.example .env.local
npm install && npm run dev               # http://localhost:3001
```

---

## API contract (frozen — both frontends code against this)

Base URL: `${NEXT_PUBLIC_API_URL}`. All responses are JSON. Auth is carried by
`HttpOnly; Secure; SameSite` cookies, so every browser call uses `credentials: 'include'`.
Admin and client sessions use different cookie names and different signing secrets and are
never interchangeable.

**Success**

```json
{ "data": { }, "meta": { "page": 1, "pageSize": 20, "total": 0, "totalPages": 0 } }
```

**Error** — never leaks stack traces, SQL, or configuration.

```json
{ "code": "VALIDATION_FAILED", "message": "Some fields need your attention.",
  "requestId": "b3f1…", "details": { "email": ["Enter a valid email address."] } }
```

### `/api/v1/public/*` — no auth

| Method | Path                     | Purpose                                    |
| ------ | ------------------------ | ------------------------------------------ |
| GET    | `/plans`                 | Active plans for the pricing page           |
| GET    | `/settings`              | Public platform name, support email, trial days |
| GET    | `/stats`                 | Count of live stores (no PII)               |
| POST   | `/register`              | Create client account, send verification    |
| POST   | `/login`                 | Client sign in                              |
| POST   | `/logout`                | Client sign out                             |
| POST   | `/verify-email`          | Consume verification token                  |
| POST   | `/resend-verification`   | Re-issue verification email (rate limited)  |
| POST   | `/forgot-password`       | Always returns 200, never reveals existence |
| POST   | `/reset-password`        | Consume reset token, set new password       |
| GET    | `/subdomain/check?value=`| Availability convenience check              |
| POST   | `/contact`               | Public contact form (rate limited)          |

### `/api/v1/client/*` — client session cookie

`GET /me` · `PUT /profile` · `POST /password` · `GET /sessions` · `DELETE /sessions/:id` · `GET /overview`
`GET /business` · `PUT /business` (optional invoice details)
`GET /onboarding` (reports `trialOffer.available`) · `POST /onboarding/plan` (`{ planId, billingCycle }` — the free trial is a plan, never a flag) · `POST /onboarding/payment` · `POST /onboarding/website`
`POST /onboarding/admin-panel` (stages the login, emails a passcode) · `POST /onboarding/admin-panel/resend` · `POST /onboarding/admin-panel/verify` (the passcode; provisioning starts here)
`GET /store` · `POST /store/retry-provisioning` · `GET /notifications`
`POST /store/admin-password/request` · `POST /store/admin-password/reset` (passcode to the **store admin** address, not the account's)
`GET /subscription` · `POST /subscription/change` · `POST /subscription/cancel` · `POST /subscription/reactivate`
`GET /payments` · `POST /payments/checkout` · `GET /invoices` · `GET /invoices/:id` · `GET /invoices/:id/download`
`GET /domains` · `POST /domains` · `POST /domains/:id/verify` · `DELETE /domains/:id`
`GET /support` · `POST /support` · `GET /support/:id` · `POST /support/:id/reply`

### `/api/v1/admin/*` — admin session cookie (MFA enforced)

`GET /session` (unguarded, never 401s — the one authority on sign-in state)
`POST /login` · `POST /mfa/verify` · `POST /logout` · `GET /me` · `POST /reauth`
`POST /mfa/setup` · `POST /mfa/enable` · `POST /mfa/recovery-codes` · `POST /password`
`GET /dashboard?range=&from=&to=` · `GET /dashboard/charts?range=&from=&to=` · `GET /support/counts`
`GET /notifications` · `GET /notifications/counts` · `POST /notifications/:id/read` · `POST /notifications/read-all`
`GET /clients` · `GET /clients/:id` · `POST /clients/:id/suspend` · `POST /clients/:id/reactivate` · `POST /clients/:id/extend-trial` · `POST /clients/:id/change-plan`
`GET /plans` · `POST /plans` · `PUT /plans/:id` · `POST /plans/:id/status`
`GET /trials` · `GET /trials/summary` · `POST /trials/:id/extend` · `POST /trials/:id/end`
`GET /subscriptions` · `POST /subscriptions/:id/cancel` · `POST /subscriptions/:id/reactivate`
`GET /payments` · `GET /invoices` · `GET /invoices/:id/download` · `POST /invoices/:id/send`
`GET /domains` · `POST /domains/:id/verify` · `POST /domains/:id/disable` · `DELETE /domains/:id`
`GET /provisioning` · `POST /provisioning/:id/retry`
`GET /support` · `GET /support/:id` · `POST /support/:id/reply` · `POST /support/:id/status`
`GET /audit` · `GET /settings` · `PUT /settings`

Suspend, reactivate, extend-trial, change-plan, subscription cancel/reactivate,
domain disable/remove, MFA setup/enable, recovery-code regeneration and settings
writes additionally require a **recent** authentication and return
`REAUTH_REQUIRED` when the session has gone stale. `POST /reauth` clears that
state, and the admin panel prompts and retries automatically.

**Two admin cookies.** `company_admin_mfa` is a short-lived MFA challenge that no
admin endpoint accepts; `company_admin_session` means credentials *and* MFA are
proven. The token is rotated when one is exchanged for the other.

### `/api/v1/webhooks/*` — signature verified, no session

`POST /payments/:provider` — HMAC signature check, amount/currency match against
the pending payment, idempotent on `provider + event_id`.
`GET /mock-checkout` — development-only stub that signs and posts a real webhook
to itself, so the verified-payment path is exercised without a live gateway.

### `/api/v1/internal/*` — `x-internal-key` header

`GET /tenants/:tenantRef` — tenant status and plan entitlements.
`POST /tenants/:tenantRef/usage` — usage report the downgrade check reads.
Reserved for the future client platform; never reachable from a browser session.

---

## Environment split

| Variable group                    | company-api | company-web | company-admin |
| --------------------------------- | ----------- | ----------- | ------------- |
| `COMPANY_DATABASE_URL`, `REDIS_URL` | yes       | no          | no            |
| `TENANT_DB_*`, `R2_*`, `PAYMENT_*`, `SMTP_*` | yes | no       | no            |
| `ADMIN_AUTH_SECRET`, `CLIENT_AUTH_SECRET`, `ENCRYPTION_KEY` | yes | no | no    |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_PLATFORM_NAME` | no | yes      | yes           |

---

## Design system

Both frontends share the same visual language (violet `#7C5CFC` accent, deep navy dark
surfaces, soft light surfaces) but each keeps its **own copy** of the tokens and UI
primitives so neither depends on the other. Light and dark themes are supported in both
apps via `next-themes` + CSS custom properties, with no flash on first paint.
`company-web` defaults to the system theme; `company-admin` defaults to dark.

---

## Verified end to end

Against the live PostgreSQL and Redis instances, with all three apps running:

**Provisioning and billing**
- `company_control_db` with 26 tables; `tenant_abc_fashion_db` and
  `tenant_preselect_shop_db` created by provisioning, each with its own
  `store_settings`, `store_admins` and `platform_sync`.
- Full flow twice: register → verify email → sign in → business → store → plan →
  complete → 7 provisioning steps → trial started → checkout →
  signature-verified webhook → subscription active → trial converted → invoice
  issued. A plan clicked on the pricing page arrives **preselected** at the plan
  step.

**Admin auth**
- Login with MFA on issues only `company_admin_mfa`; that cookie is refused by
  admin endpoints, and `/dashboard` resolves in exactly **one** redirect to a
  sign-in page resuming at the code step — the old ping-pong is gone.
- Completing MFA rotates the session token (verified in the database) and swaps
  the cookie.
- With `authenticated_at` pushed back 30 minutes, suspend returned
  `REAUTH_REQUIRED`; `/reauth` without a code returned `MFA_REQUIRED`; with a
  wrong password, `INVALID_CREDENTIALS`; with password + TOTP it succeeded and
  the retried suspend went through. Audit log reads
  `admin_login → admin_reauth → client_suspended → client_reactivated`.
- Recovery codes regenerate behind re-auth; a used code is rejected.

**Surfaces**
- All 15 admin routes and all 24 website routes return 200 (404 for removed
  `/templates`), with **zero server errors** in either log.
- Notification feed returns real events; mark-one and mark-all decrement the
  unread count and persist.

**Security**
- Forged webhook signature rejected; replay returned `duplicate` without
  re-applying; cross-origin write blocked; a second `company_admin` insert
  rejected by the database; duplicate slug rejected; no commerce tables in the
  control plane; passwords `$argon2id$`, and session tokens are signed JWTs that
  are never stored at all — revocation is the Redis record each one names.
