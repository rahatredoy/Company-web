-- Sign-in by phone number, and sign-in with Google.
--
-- Three things happen here and they are separable on purpose.
--
-- 1. `customers.email` stops being mandatory. An account created from a phone
--    number has no address until its owner adds one. Nothing else has to change
--    for that: Postgres treats NULLs in a unique index as distinct, so
--    `customers_email_key` keeps refusing a duplicate address while allowing any
--    number of accounts that have none.
--
-- 2. A **new** column carries the phone identity rather than the existing one.
--    `customers.phone` has always been a contact detail that an admin or a
--    customer could type in any shape, so it holds whatever a store has
--    collected over its life and cannot be given a unique index without a data
--    migration that would have to discard somebody's number. `phone_e164` is
--    written only by a passed one-time code, so every value in it is normalised,
--    unique and proved to belong to whoever holds the handset.
--
-- 3. `customer_identities` links an account to a sign-in provider. The
--    provider's own subject id is what identifies the person — never the email
--    address, which a Workspace administrator can change and which Gmail can in
--    principle reissue.
ALTER TABLE "customers" ALTER COLUMN "email" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "phone_e164" varchar(20);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "phone_verified_at" timestamptz;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customers_phone_e164_key" ON "customers" ("phone_e164");
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "customer_identity_provider" AS ENUM ('google');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_identities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "provider" "customer_identity_provider" NOT NULL,
  "subject" varchar(255) NOT NULL,
  "email" varchar(254),
  "last_login_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customer_identities_provider_subject_key" ON "customer_identities" ("provider","subject");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_identities_customer_idx" ON "customer_identities" ("customer_id");
