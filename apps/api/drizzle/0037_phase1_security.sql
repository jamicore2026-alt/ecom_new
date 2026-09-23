-- Phase 1 security hardening: MFA, staff sessions, webhook rotation + DLQ.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_secret" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_backup_codes" jsonb NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS "sessions" (
  "id" varchar(30) PRIMARY KEY,
  "merchant_id" varchar(30) NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
  "user_id" varchar(30) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "jti_hash" varchar(64) NOT NULL,
  "ip" varchar(64),
  "user_agent" varchar(512),
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_jti_hash_idx" ON "sessions" ("jti_hash");
CREATE INDEX IF NOT EXISTS "sessions_merchant_user_idx" ON "sessions" ("merchant_id", "user_id");

ALTER TABLE "webhook_endpoints" ADD COLUMN IF NOT EXISTS "secret_prev" varchar(255);
ALTER TABLE "webhook_endpoints" ADD COLUMN IF NOT EXISTS "secret_version" integer NOT NULL DEFAULT 1;
ALTER TABLE "webhook_deliveries" ADD COLUMN IF NOT EXISTS "dead_lettered_at" timestamptz;
