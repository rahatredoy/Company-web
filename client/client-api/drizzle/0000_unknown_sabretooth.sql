CREATE TYPE "public"."address_type" AS ENUM('shipping', 'billing');--> statement-breakpoint
CREATE TYPE "public"."admin_role_key" AS ENUM('STORE_SUPER_ADMIN', 'STORE_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."admin_status" AS ENUM('invited', 'active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."admin_token_purpose" AS ENUM('claim', 'password_reset');--> statement-breakpoint
CREATE TYPE "public"."coupon_status" AS ENUM('active', 'scheduled', 'expired', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('active', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."customer_type" AS ENUM('new', 'repeat', 'vip', 'high_value');--> statement-breakpoint
CREATE TYPE "public"."damage_reason" AS ENUM('customer_return', 'shipping_damage', 'warehouse_damage', 'manufacturing_defect', 'expired', 'missing_parts', 'other');--> statement-breakpoint
CREATE TYPE "public"."discount_scope" AS ENUM('order', 'product', 'category');--> statement-breakpoint
CREATE TYPE "public"."discount_type" AS ENUM('percentage', 'fixed', 'free_shipping', 'buy_x_get_y');--> statement-breakpoint
CREATE TYPE "public"."inspection_result" AS ENUM('good', 'damaged', 'repairable', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."inventory_bucket" AS ENUM('available', 'reserved', 'return_pending', 'damaged', 'incoming');--> statement-breakpoint
CREATE TYPE "public"."inventory_transaction_type" AS ENUM('initial', 'adjustment', 'order_reserved', 'order_released', 'order_fulfilled', 'return_received', 'return_restocked', 'damaged', 'repaired', 'disposed', 'received', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."media_type" AS ENUM('image', 'video');--> statement-breakpoint
CREATE TYPE "public"."navigation_location" AS ENUM('header', 'footer');--> statement-breakpoint
CREATE TYPE "public"."navigation_target_type" AS ENUM('page', 'category', 'url');--> statement-breakpoint
CREATE TYPE "public"."store_notification_channel" AS ENUM('email', 'sms', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."store_notification_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('new', 'pending', 'confirmed', 'processing', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'returned', 'refunded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."order_payment_status" AS ENUM('pending', 'paid', 'failed', 'partially_paid', 'refunded', 'partially_refunded', 'cod_pending');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."product_type" AS ENUM('simple', 'variable');--> statement-breakpoint
CREATE TYPE "public"."publish_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('requested', 'approved', 'rejected', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."return_resolution" AS ENUM('refund', 'exchange', 'replacement');--> statement-breakpoint
CREATE TYPE "public"."return_status" AS ENUM('requested', 'under_review', 'approved', 'rejected', 'received', 'inspected', 'completed');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."security_event_type" AS ENUM('login_success', 'login_failed', 'logout', 'account_claimed', 'password_changed', 'password_reset_requested', 'mfa_enabled', 'mfa_disabled', 'recovery_codes_regenerated', 'session_revoked', 'permission_changed', 'staff_created', 'staff_disabled');--> statement-breakpoint
CREATE TYPE "public"."shipping_status" AS ENUM('not_shipped', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'returned');--> statement-breakpoint
CREATE TYPE "public"."subscriber_status" AS ENUM('subscribed', 'unsubscribed');--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- HAND-EDITED: `platform_sync`, `store_settings` and `store_admins` are created
-- by COMPANY provisioning before this migration ever runs, so their CREATE
-- statements use IF NOT EXISTS and the columns this platform adds are applied
-- with ADD COLUMN IF NOT EXISTS at the end of the file. Regenerating migration
-- 0000 will drop those edits — keep them.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "platform_sync" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(64) NOT NULL,
	"value" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_ref" varchar(24) NOT NULL,
	"store_name" varchar(120) NOT NULL,
	"slug" varchar(40) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"language" varchar(8) DEFAULT 'en' NOT NULL,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"storefront_template" varchar(40) DEFAULT 'modern-shop' NOT NULL,
	"storefront_url" text,
	"admin_url" text,
	"plan_code" varchar(40),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"business_name" varchar(160),
	"business_email" varchar(254),
	"business_phone" varchar(24),
	"business_address" text,
	"logo_url" text,
	"favicon_url" text,
	"preferences" jsonb,
	"seo_title" varchar(160),
	"seo_description" varchar(300),
	"social_image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storefront_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_key" varchar(40) DEFAULT 'modern_shop' NOT NULL,
	"color_theme_key" varchar(40) DEFAULT 'royal_blue' NOT NULL,
	"logo_url" text,
	"favicon_url" text,
	"homepage_configuration" jsonb,
	"header_configuration" jsonb,
	"footer_configuration" jsonb,
	"draft_template_key" varchar(40),
	"draft_color_theme_key" varchar(40),
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid,
	"admin_label" varchar(254),
	"action" varchar(64) NOT NULL,
	"module" varchar(40) NOT NULL,
	"entity" varchar(40),
	"entity_id" varchar(64),
	"entity_label" varchar(200),
	"old_values" jsonb,
	"new_values" jsonb,
	"ip_address" varchar(64),
	"user_agent" text,
	"request_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"ip_address" varchar(64),
	"user_agent" text,
	"successful" boolean DEFAULT false NOT NULL,
	"failure_reason" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"purpose" "admin_token_purpose" DEFAULT 'password_reset' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"requested_ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_permissions" (
	"key" varchar(60) PRIMARY KEY NOT NULL,
	"group_name" varchar(40) NOT NULL,
	"label" varchar(80) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_key" varchar(60) NOT NULL,
	CONSTRAINT "admin_role_permissions_role_id_permission_key_pk" PRIMARY KEY("role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "admin_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" "admin_role_key" NOT NULL,
	"name" varchar(60) NOT NULL,
	"description" varchar(200),
	"is_system" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid,
	"type" "security_event_type" NOT NULL,
	"description" varchar(200),
	"ip_address" varchar(64),
	"user_agent" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"tenant_ref" varchar(24) NOT NULL,
	"mfa_verified" boolean DEFAULT false NOT NULL,
	"remember" boolean DEFAULT false NOT NULL,
	"ip_address" varchar(64),
	"user_agent" text,
	"authenticated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_user_permissions" (
	"admin_id" uuid NOT NULL,
	"permission_key" varchar(60) NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" uuid,
	CONSTRAINT "admin_user_permissions_admin_id_permission_key_pk" PRIMARY KEY("admin_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"full_name" varchar(120) NOT NULL,
	"role" varchar(20) DEFAULT 'owner' NOT NULL,
	"status" varchar(20) DEFAULT 'invited' NOT NULL,
	"password_hash" text,
	"last_login_at" timestamp with time zone,
	"role_key" "admin_role_key" DEFAULT 'STORE_ADMIN' NOT NULL,
	"account_status" "admin_status" DEFAULT 'invited' NOT NULL,
	"phone" varchar(24),
	"avatar_url" text,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_secret_encrypted" text,
	"mfa_enabled_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_ip" varchar(64),
	"password_changed_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_id_store_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."store_admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_password_reset_tokens" ADD CONSTRAINT "admin_password_reset_tokens_admin_id_store_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."store_admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_recovery_codes" ADD CONSTRAINT "admin_recovery_codes_admin_id_store_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."store_admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_role_permissions" ADD CONSTRAINT "admin_role_permissions_role_id_admin_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."admin_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_role_permissions" ADD CONSTRAINT "admin_role_permissions_permission_key_admin_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."admin_permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_security_events" ADD CONSTRAINT "admin_security_events_admin_id_store_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."store_admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_store_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."store_admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_user_permissions" ADD CONSTRAINT "admin_user_permissions_admin_id_store_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."store_admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_user_permissions" ADD CONSTRAINT "admin_user_permissions_permission_key_admin_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."admin_permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_sync_key_key" ON "platform_sync" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_settings_tenant_ref_key" ON "store_settings" USING btree ("tenant_ref");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_created_idx" ON "admin_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_module_idx" ON "admin_audit_logs" USING btree ("module","created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_entity_idx" ON "admin_audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "admin_login_attempts_email_idx" ON "admin_login_attempts" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "admin_login_attempts_ip_idx" ON "admin_login_attempts" USING btree ("ip_address","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_password_reset_tokens_hash_key" ON "admin_password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "admin_password_reset_tokens_admin_idx" ON "admin_password_reset_tokens" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "admin_permissions_group_idx" ON "admin_permissions" USING btree ("group_name","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_recovery_codes_hash_key" ON "admin_recovery_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "admin_recovery_codes_admin_idx" ON "admin_recovery_codes" USING btree ("admin_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_roles_key_key" ON "admin_roles" USING btree ("key");--> statement-breakpoint
CREATE INDEX "admin_security_events_created_idx" ON "admin_security_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_sessions_token_key" ON "admin_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "admin_sessions_admin_idx" ON "admin_sessions" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "admin_sessions_expires_idx" ON "admin_sessions" USING btree ("expires_at");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- HAND-EDITED: bring an already-provisioned tenant up to the full shape. On a
-- database created by company provisioning these three tables already exist
-- with only their original columns, so every column this platform adds is
-- applied idempotently here.
-- ---------------------------------------------------------------------------
ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "business_name" varchar(160);--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "business_email" varchar(254);--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "business_phone" varchar(24);--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "business_address" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "logo_url" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "favicon_url" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "preferences" jsonb;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "seo_title" varchar(160);--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "seo_description" varchar(300);--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "social_image_url" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "store_admins" ADD COLUMN IF NOT EXISTS "role_key" "admin_role_key" DEFAULT 'STORE_ADMIN' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_admins" ADD COLUMN IF NOT EXISTS "account_status" "admin_status" DEFAULT 'invited' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_admins" ADD COLUMN IF NOT EXISTS "phone" varchar(24);--> statement-breakpoint
ALTER TABLE "store_admins" ADD COLUMN IF NOT EXISTS "avatar_url" text;--> statement-breakpoint
ALTER TABLE "store_admins" ADD COLUMN IF NOT EXISTS "mfa_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "store_admins" ADD COLUMN IF NOT EXISTS "mfa_secret_encrypted" text;--> statement-breakpoint
ALTER TABLE "store_admins" ADD COLUMN IF NOT EXISTS "mfa_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store_admins" ADD COLUMN IF NOT EXISTS "failed_login_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_admins" ADD COLUMN IF NOT EXISTS "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store_admins" ADD COLUMN IF NOT EXISTS "last_login_ip" varchar(64);--> statement-breakpoint
ALTER TABLE "store_admins" ADD COLUMN IF NOT EXISTS "password_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store_admins" ADD COLUMN IF NOT EXISTS "claimed_at" timestamp with time zone;--> statement-breakpoint
-- The provisioned owner row is the store's first STORE_SUPER_ADMIN.
UPDATE "store_admins" SET "role_key" = 'STORE_SUPER_ADMIN' WHERE "role" = 'owner';--> statement-breakpoint
UPDATE "store_admins" SET "account_status" = 'invited' WHERE "status" = 'invited' AND "password_hash" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_admins_role_idx" ON "store_admins" USING btree ("role_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_admins_status_idx" ON "store_admins" USING btree ("account_status");