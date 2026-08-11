DROP TABLE "company_admin_recovery_codes" CASCADE;--> statement-breakpoint
ALTER TABLE "company_admin" DROP COLUMN "mfa_enabled";--> statement-breakpoint
ALTER TABLE "company_admin" DROP COLUMN "mfa_secret_encrypted";--> statement-breakpoint
ALTER TABLE "company_admin" DROP COLUMN "mfa_enabled_at";--> statement-breakpoint
ALTER TABLE "company_admin_sessions" DROP COLUMN "mfa_verified";