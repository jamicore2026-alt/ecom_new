-- 0033_security_hardening: tenant-isolate previously global tables, lock down
-- platform_admins for the tenant role, and add missing hot-path indexes.
-- Fully idempotent (IF NOT EXISTS / guarded DO blocks) so it is safe to run
-- on databases that were provisioned by db:push or the old one-off scripts.
-- NOTE: the next `drizzle-kit generate` will diff schema.ts against the 0031
-- snapshot and re-emit the 0032/0033 DDL — discard/merge that output, the
-- RLS + REVOKE statements below cannot be generated and must be kept by hand.
ALTER TABLE "webhook_events" ADD COLUMN IF NOT EXISTS "merchant_id" varchar(30) REFERENCES "merchants"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "token_blacklist" ADD COLUMN IF NOT EXISTS "merchant_id" varchar(30) REFERENCES "merchants"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_events_merchant_idx" ON "webhook_events" ("merchant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "token_blacklist_merchant_idx" ON "token_blacklist" ("merchant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "password_reset_tokens_hash_idx" ON "password_reset_tokens" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_tokens_hash_idx" ON "verification_tokens" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_prefix_idx" ON "api_keys" ("key_prefix");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "carts_recovery_code_idx" ON "carts" ("recovery_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_outlets_user_idx" ON "user_outlets" ("user_id");
--> statement-breakpoint
ALTER TABLE "webhook_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'webhook_events' AND policyname = 'rls_webhook_events') THEN
    CREATE POLICY "rls_webhook_events" ON "webhook_events"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "token_blacklist" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "token_blacklist" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'token_blacklist' AND policyname = 'rls_token_blacklist') THEN
    CREATE POLICY "rls_token_blacklist" ON "token_blacklist"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "platform_admins" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "platform_admins" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Guarded: on a fresh database the tenant roles may not exist yet (they are
-- created by 0029_manual_role_setup.sql, which is intentionally NOT part of
-- the automated journal). An unguarded REVOKE aborts `db:migrate` with
-- "role does not exist". RLS default-deny above still blocks the role once
-- created; the manual setup file repeats the REVOKE after its grants.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    REVOKE ALL ON "platform_admins" FROM "app_runtime";
  END IF;
END $$;
