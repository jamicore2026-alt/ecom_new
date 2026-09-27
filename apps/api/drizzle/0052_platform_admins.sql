-- Platform multi-admin lifecycle, session revocation, MFA columns.
ALTER TABLE "platform_admins" ADD COLUMN IF NOT EXISTS "status" varchar(20) NOT NULL DEFAULT 'active';
ALTER TABLE "platform_admins" ADD COLUMN IF NOT EXISTS "last_login_at" timestamptz;
ALTER TABLE "platform_admins" ADD COLUMN IF NOT EXISTS "token_version" integer NOT NULL DEFAULT 0;
ALTER TABLE "platform_admins" ADD COLUMN IF NOT EXISTS "mfa_secret" text;
ALTER TABLE "platform_admins" ADD COLUMN IF NOT EXISTS "mfa_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "platform_admins" ADD COLUMN IF NOT EXISTS "mfa_backup_codes" jsonb NOT NULL DEFAULT '[]';
CREATE TABLE IF NOT EXISTS "platform_token_blacklist" (
  "jti" varchar(64) PRIMARY KEY,
  "admin_id" varchar(30) REFERENCES "platform_admins"("id") ON DELETE CASCADE,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
