CREATE TYPE "public"."activity_type" AS ENUM('client_registered', 'trial_started', 'trial_expiring', 'payment_received', 'subscription_activated', 'subscription_cancelled', 'store_provisioned', 'domain_connected');--> statement-breakpoint
CREATE TYPE "public"."billing_cycle" AS ENUM('monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."client_account_status" AS ENUM('pending_verification', 'active', 'suspended', 'closed');--> statement-breakpoint
CREATE TYPE "public"."company_admin_status" AS ENUM('active', 'locked', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."domain_status" AS ENUM('pending', 'verifying', 'active', 'failed', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."domain_type" AS ENUM('platform_subdomain', 'storefront_custom', 'admin_custom');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'issued', 'paid', 'void', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('email', 'sms', 'whatsapp', 'in_app');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."onboarding_step" AS ENUM('business', 'store', 'plan', 'review', 'done');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'paid', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."provisioning_status" AS ENUM('pending', 'creating', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."provisioning_step" AS ENUM('tenant_record', 'tenant_database', 'tenant_schema', 'store_configuration', 'store_admin', 'platform_subdomain', 'store_ready');--> statement-breakpoint
CREATE TYPE "public"."store_status" AS ENUM('not_created', 'creating', 'ready', 'failed', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trial', 'active', 'past_due', 'expired', 'cancelled', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."support_author_type" AS ENUM('client', 'admin');--> statement-breakpoint
CREATE TYPE "public"."support_level" AS ENUM('email', 'priority', 'dedicated');--> statement-breakpoint
CREATE TYPE "public"."support_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."support_ticket_status" AS ENUM('open', 'in_progress', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('pending', 'provisioning', 'trial', 'active', 'expired', 'suspended', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."trial_status" AS ENUM('active', 'expired', 'converted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."webhook_event_status" AS ENUM('received', 'processed', 'ignored', 'failed');--> statement-breakpoint
CREATE TABLE "company_admin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"password_hash" text NOT NULL,
	"status" "company_admin_status" DEFAULT 'active' NOT NULL,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_secret_encrypted" text,
	"mfa_enabled_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"last_login_ip" varchar(64),
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"singleton" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_admin_login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"ip_address" varchar(64),
	"user_agent" text,
	"successful" boolean DEFAULT false NOT NULL,
	"failure_reason" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_admin_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"mfa_verified" boolean DEFAULT false NOT NULL,
	"ip_address" varchar(64),
	"user_agent" text,
	"authenticated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(120) NOT NULL,
	"email" varchar(254) NOT NULL,
	"phone" varchar(24),
	"password_hash" text NOT NULL,
	"status" "client_account_status" DEFAULT 'pending_verification' NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"email_verified_at" timestamp with time zone,
	"onboarding_step" "onboarding_step" DEFAULT 'business' NOT NULL,
	"onboarding_completed" boolean DEFAULT false NOT NULL,
	"intended_plan_code" varchar(40),
	"intended_billing_cycle" varchar(10),
	"accepted_terms_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"last_login_ip" varchar(64),
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_business_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_account_id" uuid NOT NULL,
	"business_name" varchar(160) NOT NULL,
	"owner_name" varchar(120) NOT NULL,
	"business_email" varchar(254) NOT NULL,
	"business_phone" varchar(24),
	"country" varchar(60) NOT NULL,
	"address" text NOT NULL,
	"business_type" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_email_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_account_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"ip_address" varchar(64),
	"user_agent" text,
	"successful" boolean DEFAULT false NOT NULL,
	"failure_reason" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_account_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"requested_ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_account_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"ip_address" varchar(64),
	"user_agent" text,
	"authenticated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"domain" varchar(253) NOT NULL,
	"domain_type" "domain_type" NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"status" "domain_status" DEFAULT 'pending' NOT NULL,
	"verification_token" varchar(64),
	"last_checked_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provisioning_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" "provisioning_status" DEFAULT 'pending' NOT NULL,
	"current_step" "provisioning_step",
	"completed_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempts" text DEFAULT '0' NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_ref" varchar(24) NOT NULL,
	"client_account_id" uuid NOT NULL,
	"business_profile_id" uuid,
	"store_name" varchar(120) NOT NULL,
	"slug" varchar(40) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"language" varchar(8) DEFAULT 'en' NOT NULL,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"storefront_template" varchar(40) DEFAULT 'modern-shop' NOT NULL,
	"status" "tenant_status" DEFAULT 'pending' NOT NULL,
	"store_status" "store_status" DEFAULT 'not_created' NOT NULL,
	"database_name" varchar(80),
	"activated_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_account_id" uuid NOT NULL,
	"subscription_id" uuid,
	"payment_id" uuid,
	"plan_id" uuid,
	"invoice_number" varchar(32) NOT NULL,
	"sequence" integer NOT NULL,
	"billing_cycle" "billing_cycle" DEFAULT 'monthly' NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"status" "invoice_status" DEFAULT 'issued' NOT NULL,
	"bill_to" jsonb,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(40) NOT NULL,
	"event_id" varchar(128) NOT NULL,
	"event_type" varchar(64),
	"status" "webhook_event_status" DEFAULT 'received' NOT NULL,
	"payment_id" uuid,
	"payload" jsonb,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_account_id" uuid NOT NULL,
	"subscription_id" uuid,
	"plan_id" uuid,
	"provider" varchar(40) NOT NULL,
	"reference" varchar(64) NOT NULL,
	"transaction_id" varchar(128),
	"amount" numeric(12, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"billing_cycle" "billing_cycle" DEFAULT 'monthly' NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"paid_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(60) NOT NULL,
	"code" varchar(40) NOT NULL,
	"description" varchar(200),
	"monthly_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"yearly_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"product_limit" integer,
	"admin_limit" integer,
	"storage_limit_mb" integer,
	"custom_domain_enabled" boolean DEFAULT false NOT NULL,
	"custom_admin_domain_enabled" boolean DEFAULT false NOT NULL,
	"analytics_enabled" boolean DEFAULT false NOT NULL,
	"reports_enabled" boolean DEFAULT false NOT NULL,
	"support_level" "support_level" DEFAULT 'email' NOT NULL,
	"status" "plan_status" DEFAULT 'active' NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"billing_cycle" "billing_cycle" DEFAULT 'monthly' NOT NULL,
	"price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"status" "subscription_status" DEFAULT 'trial' NOT NULL,
	"started_at" timestamp with time zone,
	"renewal_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid,
	"started_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"status" "trial_status" DEFAULT 'active' NOT NULL,
	"reminders_sent" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extended_by_days" integer DEFAULT 0 NOT NULL,
	"converted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"email" varchar(254) NOT NULL,
	"company" varchar(160),
	"message" text NOT NULL,
	"ip_address" varchar(64),
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_type" "support_author_type" NOT NULL,
	"author_name" varchar(120) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(24) NOT NULL,
	"client_account_id" uuid NOT NULL,
	"tenant_id" uuid,
	"subject" varchar(160) NOT NULL,
	"status" "support_ticket_status" DEFAULT 'open' NOT NULL,
	"priority" "support_priority" DEFAULT 'normal' NOT NULL,
	"message_count" integer DEFAULT 1 NOT NULL,
	"last_reply_at" timestamp with time zone,
	"last_reply_by" "support_author_type",
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "activity_type" NOT NULL,
	"client_account_id" uuid,
	"tenant_id" uuid,
	"title" varchar(160) NOT NULL,
	"subject" varchar(160) NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" varchar(64) NOT NULL,
	"actor_type" varchar(20) DEFAULT 'admin' NOT NULL,
	"actor_id" uuid,
	"actor_label" varchar(254),
	"tenant_id" uuid,
	"client_account_id" uuid,
	"target_label" varchar(200),
	"old_value" text,
	"new_value" text,
	"ip_address" varchar(64),
	"user_agent" text,
	"request_id" varchar(64),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_account_id" uuid,
	"tenant_id" uuid,
	"channel" "notification_channel" DEFAULT 'email' NOT NULL,
	"template" varchar(64) NOT NULL,
	"recipient" varchar(254) NOT NULL,
	"subject" varchar(200),
	"status" "notification_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(64) NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_admin_recovery_codes" ADD CONSTRAINT "company_admin_recovery_codes_admin_id_company_admin_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."company_admin"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_admin_sessions" ADD CONSTRAINT "company_admin_sessions_admin_id_company_admin_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."company_admin"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_business_profiles" ADD CONSTRAINT "client_business_profiles_client_account_id_client_accounts_id_fk" FOREIGN KEY ("client_account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_email_verification_tokens" ADD CONSTRAINT "client_email_verification_tokens_client_account_id_client_accounts_id_fk" FOREIGN KEY ("client_account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_password_reset_tokens" ADD CONSTRAINT "client_password_reset_tokens_client_account_id_client_accounts_id_fk" FOREIGN KEY ("client_account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_sessions" ADD CONSTRAINT "client_sessions_client_account_id_client_accounts_id_fk" FOREIGN KEY ("client_account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_jobs" ADD CONSTRAINT "provisioning_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_client_account_id_client_accounts_id_fk" FOREIGN KEY ("client_account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_business_profile_id_client_business_profiles_id_fk" FOREIGN KEY ("business_profile_id") REFERENCES "public"."client_business_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_account_id_client_accounts_id_fk" FOREIGN KEY ("client_account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_client_account_id_client_accounts_id_fk" FOREIGN KEY ("client_account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trials" ADD CONSTRAINT "trials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trials" ADD CONSTRAINT "trials_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_client_account_id_client_accounts_id_fk" FOREIGN KEY ("client_account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_client_account_id_client_accounts_id_fk" FOREIGN KEY ("client_account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_client_account_id_client_accounts_id_fk" FOREIGN KEY ("client_account_id") REFERENCES "public"."client_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_client_account_id_client_accounts_id_fk" FOREIGN KEY ("client_account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_admin_singleton_key" ON "company_admin" USING btree ("singleton");--> statement-breakpoint
CREATE UNIQUE INDEX "company_admin_email_key" ON "company_admin" USING btree ("email");--> statement-breakpoint
CREATE INDEX "company_admin_login_attempts_email_idx" ON "company_admin_login_attempts" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "company_admin_login_attempts_ip_idx" ON "company_admin_login_attempts" USING btree ("ip_address","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "company_admin_recovery_codes_hash_key" ON "company_admin_recovery_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "company_admin_recovery_codes_admin_idx" ON "company_admin_recovery_codes" USING btree ("admin_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_admin_sessions_token_key" ON "company_admin_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "company_admin_sessions_admin_idx" ON "company_admin_sessions" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "company_admin_sessions_expires_idx" ON "company_admin_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "client_accounts_email_key" ON "client_accounts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "client_accounts_status_idx" ON "client_accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "client_accounts_created_idx" ON "client_accounts" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "client_business_profiles_account_key" ON "client_business_profiles" USING btree ("client_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_email_verification_tokens_hash_key" ON "client_email_verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "client_email_verification_tokens_account_idx" ON "client_email_verification_tokens" USING btree ("client_account_id");--> statement-breakpoint
CREATE INDEX "client_login_attempts_email_idx" ON "client_login_attempts" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "client_login_attempts_ip_idx" ON "client_login_attempts" USING btree ("ip_address","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "client_password_reset_tokens_hash_key" ON "client_password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "client_password_reset_tokens_account_idx" ON "client_password_reset_tokens" USING btree ("client_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_sessions_token_key" ON "client_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "client_sessions_account_idx" ON "client_sessions" USING btree ("client_account_id");--> statement-breakpoint
CREATE INDEX "client_sessions_expires_idx" ON "client_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "domains_domain_key" ON "domains" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "domains_tenant_idx" ON "domains" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "domains_status_idx" ON "domains" USING btree ("status");--> statement-breakpoint
CREATE INDEX "provisioning_jobs_tenant_idx" ON "provisioning_jobs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "provisioning_jobs_status_idx" ON "provisioning_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_ref_key" ON "tenants" USING btree ("tenant_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_client_key" ON "tenants" USING btree ("client_account_id");--> statement-breakpoint
CREATE INDEX "tenants_status_idx" ON "tenants" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE INDEX "invoices_tenant_idx" ON "invoices" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status","issued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhook_events_provider_event_key" ON "payment_webhook_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "payment_webhook_events_status_idx" ON "payment_webhook_events" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_reference_key" ON "payments" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "payments_tenant_idx" ON "payments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "payments_transaction_idx" ON "payments" USING btree ("provider","transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_code_key" ON "plans" USING btree ("code");--> statement-breakpoint
CREATE INDEX "plans_status_idx" ON "plans" USING btree ("status","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_tenant_key" ON "subscriptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "subscriptions_status_idx" ON "subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subscriptions_renewal_idx" ON "subscriptions" USING btree ("renewal_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trials_tenant_key" ON "trials" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "trials_status_idx" ON "trials" USING btree ("status","ends_at");--> statement-breakpoint
CREATE INDEX "contact_messages_created_idx" ON "contact_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "support_messages_ticket_idx" ON "support_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "support_tickets_reference_key" ON "support_tickets" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "support_tickets_client_idx" ON "support_tickets" USING btree ("client_account_id");--> statement-breakpoint
CREATE INDEX "support_tickets_status_idx" ON "support_tickets" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "activity_events_created_idx" ON "activity_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "activity_events_client_idx" ON "activity_events" USING btree ("client_account_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_idx" ON "audit_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notifications_client_idx" ON "notifications" USING btree ("client_account_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_status_idx" ON "notifications" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings" USING btree ("key");