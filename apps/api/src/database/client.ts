import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export const DATABASE_URL =
  process.env.APP_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5432/ecom_merchant'

export const connection = postgres(DATABASE_URL, {
  max: 10,
  // Bound worst-case query time so one slow analytics query cannot pin the pool.
  // TLS is opt-in via `?sslmode=` in the URL (e.g. ?sslmode=require) — it is
  // deliberately NOT forced here: private Docker networks (Coolify default)
  // typically run Postgres without SSL, and forcing it breaks those servers
  // at the TLS handshake. Set sslmode=require in production when the server
  // has certificates.
  connection: { statement_timeout: 30_000, idle_in_transaction_session_timeout: 30_000 }
})

export const db = drizzle(connection, { schema })

export type DB = typeof db
