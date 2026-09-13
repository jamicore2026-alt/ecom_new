-- ---------------------------------------------------------------------------
-- 0029 manual role setup — RUN AS SUPERUSER (psql), NOT via drizzle-kit.
--
--   psql "$DATABASE_URL" -f apps/api/drizzle/0029_manual_role_setup.sql
--
-- Roles:
--   app_runtime — the request-scoped tenant role. NO BYPASSRLS, so Row Level
--                 Security actually filters rows by app.current_merchant_id.
--                 Used by src/database/tenant-context.ts.
--   app_admin   — platform / background-job role. BYPASSRLS by design (jobs run
--                 cross-tenant, e.g. merchant offboarding, GDPR erasure).
--                 Default when APP_ADMIN_DATABASE_URL is set.
--
-- The dev passwords below MUST match APP_RUNTIME_DATABASE_URL /
-- APP_ADMIN_DATABASE_URL in .env. Change both in production.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime LOGIN PASSWORD 'app_runtime_dev_password'
      NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
    CREATE ROLE app_admin LOGIN PASSWORD 'app_admin_dev_password'
      BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_runtime, app_admin;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_admin;

-- Future tables/sequences created by migrations are covered automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_admin;