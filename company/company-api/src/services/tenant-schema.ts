/**
 * The initial schema created inside every tenant database.
 *
 * Deliberately minimal: the company side only seeds the handful of tables the
 * future Client Platform needs to boot (its own settings and its own admin
 * user). Products, orders, customers and inventory are NOT created here — they
 * belong to the client platform's own migrations in the next phase.
 */
export const TENANT_BOOTSTRAP_SQL = `
create extension if not exists "pgcrypto";

create table if not exists store_settings (
  id                uuid primary key default gen_random_uuid(),
  tenant_ref        varchar(24)  not null,
  store_name        varchar(120) not null,
  slug              varchar(40)  not null,
  currency          varchar(3)   not null default 'USD',
  language          varchar(8)   not null default 'en',
  timezone          varchar(64)  not null default 'UTC',
  storefront_template varchar(40) not null default 'modern-shop',
  storefront_url    text,
  admin_url         text,
  plan_code         varchar(40),
  status            varchar(20)  not null default 'active',
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now()
);

create unique index if not exists store_settings_tenant_ref_key on store_settings (tenant_ref);

create table if not exists store_admins (
  id             uuid primary key default gen_random_uuid(),
  email          varchar(254) not null,
  full_name      varchar(120) not null,
  role           varchar(20)  not null default 'owner',
  status         varchar(20)  not null default 'invited',
  password_hash  text,
  last_login_at  timestamptz,
  created_at     timestamptz  not null default now(),
  updated_at     timestamptz  not null default now()
);

create unique index if not exists store_admins_email_key on store_admins (lower(email));

-- A store has exactly one admin account, and it is the one seeded here from the
-- registered client account. Indexing a constant makes a second row impossible
-- at the database level, so no bug or stray script on either platform can add a
-- co-admin to someone's store.
create unique index if not exists store_admins_singleton_key on store_admins ((true));

create table if not exists platform_sync (
  id           uuid primary key default gen_random_uuid(),
  key          varchar(64) not null,
  value        jsonb       not null,
  synced_at    timestamptz not null default now()
);

create unique index if not exists platform_sync_key_key on platform_sync (key);
`;

/** Marks the schema version so the client platform knows what it inherited. */
export const TENANT_SCHEMA_VERSION = '1.1.0';
