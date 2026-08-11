ALTER TYPE "public"."onboarding_step" ADD VALUE 'payment';--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_account_id" uuid NOT NULL,
	"provider" varchar(40) NOT NULL,
	"provider_token" varchar(128) NOT NULL,
	"brand" varchar(40),
	"last4" varchar(4),
	"exp_month" integer,
	"exp_year" integer,
	"is_default" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_accounts" ALTER COLUMN "onboarding_step" SET DEFAULT 'plan';--> statement-breakpoint
ALTER TABLE "client_business_profiles" ALTER COLUMN "country" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "client_business_profiles" ALTER COLUMN "address" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "client_business_profiles" ALTER COLUMN "business_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "store_admin_email" varchar(254);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "store_admin_password_hash" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "purpose" varchar(24) DEFAULT 'subscription' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_client_account_id_client_accounts_id_fk" FOREIGN KEY ("client_account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_token_key" ON "payment_methods" USING btree ("provider","provider_token");--> statement-breakpoint
CREATE INDEX "payment_methods_tenant_idx" ON "payment_methods" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_methods_account_idx" ON "payment_methods" USING btree ("client_account_id");