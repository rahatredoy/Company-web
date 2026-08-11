ALTER TABLE "client_accounts" ADD COLUMN "trial_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "is_trial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "plans_single_trial_key" ON "plans" USING btree ("is_trial") WHERE "plans"."is_trial";--> statement-breakpoint
-- Hand-added: the trial is once per account for life, and accounts that took one
-- under the old per-plan checkbox have used theirs. Without this they would each
-- be handed a second trial the day the trial plan appears.
UPDATE "client_accounts" SET "trial_used_at" = COALESCE("t"."started_at", "t"."created_at")
FROM "tenants" "tn" JOIN "trials" "t" ON "t"."tenant_id" = "tn"."id"
WHERE "tn"."client_account_id" = "client_accounts"."id" AND "client_accounts"."trial_used_at" IS NULL;