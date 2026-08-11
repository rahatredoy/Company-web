ALTER TABLE "tenants" ADD COLUMN "store_admin_email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "store_admin_otp_purpose" varchar(32);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "store_admin_otp_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "store_admin_otp_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "store_admin_otp_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "store_admin_otp_attempts" integer DEFAULT 0 NOT NULL;