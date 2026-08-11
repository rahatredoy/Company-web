-- Rows written by the old link-based flow lost their token column in 0004, so
-- they can never verify anything again. They are cleared here because the code
-- column below is NOT NULL and has no sensible backfill value. Accounts still
-- awaiting verification simply request a fresh code.
DELETE FROM "client_email_verification_tokens";--> statement-breakpoint
ALTER TABLE "client_email_verification_tokens" ADD COLUMN "code_hash" varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE "client_email_verification_tokens" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "client_email_verification_tokens" ADD COLUMN "sent_at" timestamp with time zone DEFAULT now() NOT NULL;