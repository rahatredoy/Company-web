ALTER TABLE "store_admins" DROP COLUMN "claimed_at";--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- HAND-EDITED: everything below is not derived from the Drizzle schema.
--
-- A store has exactly one admin account — the one company provisioning seeds
-- from the registered client account, password included. There is no invite, no
-- claim and no way to add a second admin, so the database says so too: a unique
-- index on a constant admits one row and refuses the next.
--
-- New stores get this index from the company bootstrap schema; this statement is
-- what brings already-provisioned tenants in line. The guard turns the only way
-- it can fail into an error that explains itself.
-- ---------------------------------------------------------------------------
DO $$
DECLARE admin_count integer;
BEGIN
  SELECT count(*) INTO admin_count FROM store_admins;

  IF admin_count > 1 THEN
    RAISE EXCEPTION 'store_admins holds % rows; a store may only have one admin account. Remove the extra rows, then re-run this migration.', admin_count;
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS store_admins_singleton_key ON store_admins ((true));
END
$$;
