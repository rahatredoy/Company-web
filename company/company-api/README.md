# company-api

Control-plane REST API for the Multi-Tenant E-Commerce SaaS platform, plus the
background worker. This is the **only** application that holds secrets and the
only one that talks to PostgreSQL.

Fastify 5 · TypeScript · Drizzle ORM · PostgreSQL · Redis · BullMQ · Pino · Zod

---

## Setup

```bash
cp .env.example .env      # fill in database, redis, secrets
npm install

npm run db:bootstrap      # creates company_control_db if missing
npm run db:generate       # regenerates SQL from the Drizzle schema
npm run db:migrate        # applies migrations
npm run db:seed           # 4 plans, default settings, the single admin

npm run dev               # API on :4000
npm run worker:dev        # BullMQ worker (second terminal)
```

Generate the three required secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

---

## Layout

```
src/
  config/       env schema (Zod) + typed config
  db/           schema/ (26 tables), client, bootstrap, migrate, seed
  lib/          errors, crypto, password (Argon2id), totp, session, rate-limit,
                mailer, payment, dns, audit, settings, http helpers
  plugins/      request-context, security (helmet/cors/csrf/rate-limit),
                error-handler, auth guards
  modules/      public/ client/ admin/ webhooks/ internal/
  services/     provisioning, billing, dashboard, trial-sweep, views
  queues/       BullMQ queue definitions
  workers/      worker entrypoint
```

---

## Route map

| Prefix                 | Auth                          |
| ---------------------- | ----------------------------- |
| `/api/v1/public/*`     | none (rate limited)           |
| `/api/v1/client/*`     | `company_client_session` cookie |
| `/api/v1/admin/*`      | `company_admin_session` cookie + MFA |
| `/api/v1/webhooks/*`   | HMAC signature                |
| `/api/v1/internal/*`   | `x-internal-key` header       |
| `/health`              | none                          |

`GET /api/v1/routes` prints the full table in development.

---

## Security decisions worth knowing

- **One company admin, enforced in the database.** `company_admin` carries a
  constant `singleton` column with a unique index, so a second row cannot be
  inserted even if application code is bypassed. No endpoint creates admins.
- **Passwords** use Argon2id (19 MiB, t=2, p=1). Unknown accounts still burn a
  hash so timing does not reveal existence.
- **Sessions** are opaque 32-byte tokens; only their SHA-256 is stored. Admin and
  client sessions live in separate tables with separate cookies and secrets.
- **Admin MFA** is TOTP (RFC 6238) implemented on `node:crypto`. The seed is
  encrypted with AES-256-GCM; recovery codes are hashed and single-use.
- **Sensitive admin actions** (suspend, extend trial, cancel, disable domain,
  change settings) additionally require a recent authentication.
- **Payments** only ever move to `paid` from a signature-verified webhook whose
  amount and currency match the pending payment. `provider + event_id` is unique,
  which makes replays and duplicate deliveries no-ops.
- **CSRF**: cookies are `HttpOnly; SameSite=Lax`, and every unsafe method is
  additionally origin-checked against the allow-list.
- **Errors** never leak stack traces, SQL, driver text or configuration; every
  response carries a `requestId` that appears in the logs.
- **Logs** redact passwords, tokens, hashes, MFA seeds, connection strings and
  gateway secrets.
- **Tenant credentials** (`TENANT_DB_*`) are used only to create tenant
  databases. They are never returned by an endpoint or shown in the admin panel.

---

## Provisioning

`runProvisioning(tenantId)` performs seven recorded steps:

```
tenant_record → tenant_database → tenant_schema → store_configuration
   → store_admin → platform_subdomain → store_ready
```

Each step is written to `provisioning_jobs.completed_steps` before the next
begins, so a retry resumes rather than restarting. The tenant database is
created as `tenant_<slug>_db` and receives only the bootstrap schema
(`store_settings`, `store_admins`, `platform_sync`) — commerce tables belong to
the client platform's own migrations in the next phase.

**A trial's clock starts only after provisioning succeeds**, so a failed setup
never consumes trial days.

---

## Background worker

`npm run worker` runs five queues: provisioning, domain verification, the hourly
trial sweep (reminders at 10/5/2 days, then expiry), the hourly billing sweep
(past-due → expired) and notifications. If Redis is unavailable, provisioning
falls back to running inline and rate limiting fails open — both are logged.

---

## Docker

```bash
docker build -t company-api .
docker run --env-file .env -p 4000:4000 company-api            # API
docker run --env-file .env company-api npm run worker          # worker
```
