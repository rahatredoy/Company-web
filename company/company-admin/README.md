# company-admin

Company super-admin panel. Next.js 16 (App Router) · TypeScript · Tailwind CSS 4
· Recharts.

Restricted to platform staff. There is exactly **one** company administrator
account — this panel contains no way to create admins, roles or staff, by design.

```bash
cp .env.example .env.local
npm install
npm run dev        # http://localhost:3001
```

Sign in with the credentials seeded by `company-api`
(`COMPANY_ADMIN_EMAIL` / `COMPANY_ADMIN_PASSWORD`), then enable MFA immediately
from Settings → Security.

---

## Sections

`Dashboard · Clients · Subscriptions · Plans · Trials · Payments · Invoices ·
Domains · Provisioning · Support · Audit Logs · Settings`

Infrastructure surfaces — database nodes, migrations, backups, storage, Redis,
queue dashboards, worker or server management — are deliberately absent. Those
are managed outside the application.

The dashboard shows six primary KPIs with sparklines, four secondary cards, a
revenue/MRR area chart, client growth, subscription growth, a subscription-status
donut, trial conversion over time, the recent activity feed and recent clients.
Every range (7d / 30d / 3m / 6m / 1y) is mirrored into the URL, and **Custom**
reveals real from/to date inputs.

The topbar bell is a real notification feed over `activity_events` — new client,
payment received *and failed*, trial started/expiring/expired, store provisioned
*and provisioning failed*, subscription activated/cancelled, domain connected,
support ticket opened — with read state, a dropdown and a `/notifications` page.

When the API is unreachable, list pages say so explicitly instead of rendering an
empty table that looks like "no results".

---

## Auth

Two-step sign-in: credentials, then TOTP (or a single-use recovery code).

**Two cookies, two meanings.** `POST /login` issues `company_admin_mfa` when MFA
is on — a short-lived challenge that no admin endpoint accepts. Only after
`/mfa/verify` succeeds is it swapped for `company_admin_session`, with the token
**rotated** so the pre-MFA value cannot be replayed. Both the sign-in page and
the dashboard layout read `GET /api/v1/admin/session`, which never 401s, so they
can never disagree about the session state — closing the tab mid-MFA now resumes
at the code step instead of bouncing between routes.

**Sensitive actions require recent proof of identity.** Suspend, reactivate,
extend/end trial, change plan, cancel/reactivate subscription, disable or remove
a domain and settings writes all return `REAUTH_REQUIRED` once the session's last
authentication is older than `REAUTH_WINDOW_MINUTES`. `ReauthProvider`
(`src/components/admin/reauth-provider.tsx`) catches that, prompts for the
password (plus a code when MFA is on), calls `POST /api/v1/admin/reauth`, and
retries the original action **exactly once**. Call sites adopt it with a single
line — see `client-actions.tsx`.

**Account security lives in Settings → Security**: MFA enrolment (QR + manual
key + confirm + one-time recovery codes), recovery-code regeneration, and
password change. Tab selection is a URL search param, so `/settings?tab=security`
deep-links correctly.

`src/middleware.ts` only checks that the full session cookie is present, and only
ever redirects *toward* `/sign-in`; the API re-authorises every request.

---

## Theme

Dark by default (matching the reference design), with light and system available
from the toggle. Tokens are defined in `src/app/globals.css` for both palettes.

---

## Docker

```bash
docker build -t company-admin \
  --build-arg NEXT_PUBLIC_API_URL=https://api.company.com .
docker run -p 3001:3001 company-admin
```

In production, put this app behind an additional network control — Cloudflare
Access or an IP allow-list — so the login page is not publicly reachable.
