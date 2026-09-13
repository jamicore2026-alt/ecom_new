import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { connection } from '../src/database/client'

/**
 * Ensure the RLS environment exists so the suite is self-provisioning on any
 * database. The app applies this via manually-run migrations
 * (drizzle/0029_manual_role_setup.sql + 0029_enable_rls.sql); a database that
 * has tables but not yet those migrations would otherwise fail every RLS test.
 *
 * Runs ONCE per process and provisions unconditionally (row-level security
 * must be FORCED, both roles must have the right BYPASSRLS flags, and the
 * tenant role must hold explicit table privileges — any one of those being
 * off, e.g. a DB where the tenant role owns tables or grants were never
 * applied, silently breaks isolation):
 *  - repairs/creates `app_runtime` (NO BYPASSRLS) and `app_admin` (BYPASSRLS),
 *  - grants schema/table/sequence privileges,
 *  - enables + FORCES RLS with per-table policies (migration 0029, idempotent).
 */
let ready: Promise<void> | null = null

/** Resolve the migration SQL file from either cwd (apps/api) or the repo root. */
const migrationPath = (): string => {
  const fromCwd = path.join(process.cwd(), 'drizzle', '0029_enable_rls.sql')
  if (existsSync(fromCwd)) return fromCwd
  const fromRoot = path.join(process.cwd(), 'apps', 'api', 'drizzle', '0029_enable_rls.sql')
  if (existsSync(fromRoot)) return fromRoot
  throw new Error('Could not locate drizzle/0029_enable_rls.sql for RLS test bootstrap')
}

/**
 * SQL single-quoted literal (role passwords can technically contain quotes).
 */
const quoteLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`

const provision = async (): Promise<void> => {
  // Create (or repair) the tenant roles. ALTER ROLE forces the right flags even
  // when a prior setup created one of them with wrong attributes.
  await connection.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
        CREATE ROLE app_runtime LOGIN PASSWORD 'app_runtime_dev_password'
          NOSUPERUSER NOCREATEDB NOCREATEROLE;
      ELSE
        ALTER ROLE app_runtime NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
        CREATE ROLE app_admin LOGIN PASSWORD 'app_admin_dev_password'
          BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
      ELSE
        ALTER ROLE app_admin NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
      END IF;
    END
    $$;
    GRANT USAGE ON SCHEMA public TO app_runtime, app_admin;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_admin;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_admin;
  `)

  // Make the tenant role authenticate with ALWAYS the password the app is
  // configured with (APP_RUNTIME_DATABASE_URL). A manual role created earlier
  // with a different password is the classic cause of instant auth failures.
  const runtimeUrl = process.env.APP_RUNTIME_DATABASE_URL
  if (runtimeUrl) {
    let password = ''
    try {
      password = decodeURIComponent(new URL(runtimeUrl).password ?? '')
    } catch {
      password = ''
    }
    if (password) {
      await connection.unsafe(
        `ALTER ROLE app_runtime WITH LOGIN PASSWORD ${quoteLiteral(password)}`
      )
    }
  }

  // Enable + FORCE RLS and create per-table policies from migration 0029.
  // Enabling alone is not enough: RLS must be FORCED, otherwise the table owner
  // (e.g. app_runtime when it created the schema) still bypasses row-level
  // security. `--> statement-breakpoint` lines are tooling markers; running the
  // statements as one script is fine and the whole file is idempotent
  // (policies are guarded by IF NOT EXISTS).
  const script = readFileSync(migrationPath(), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*--> statement-breakpoint\s*$/.test(line))
    .join('\n')
  await connection.unsafe(script)
}

export const ensureRls = (): Promise<void> => {
  ready ??= provision()
  return ready
}