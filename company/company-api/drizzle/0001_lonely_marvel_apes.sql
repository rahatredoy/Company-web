ALTER TYPE "public"."activity_type" ADD VALUE 'trial_expired' BEFORE 'payment_received';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'payment_failed' BEFORE 'subscription_activated';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'provisioning_failed' BEFORE 'domain_connected';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'support_ticket_opened';--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "activity_events_unread_idx" ON "activity_events" USING btree ("read_at","created_at");