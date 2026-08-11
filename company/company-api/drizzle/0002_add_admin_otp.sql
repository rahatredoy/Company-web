ALTER TABLE "company_admin_sessions" ADD COLUMN "otp_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "company_admin_sessions" ADD COLUMN "otp_code_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "company_admin_sessions" ADD COLUMN "otp_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "company_admin_sessions" ADD COLUMN "otp_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "company_admin_sessions" ADD COLUMN "otp_sent_at" timestamp with time zone;