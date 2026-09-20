import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export const DATABASE_URL =
  process.env.APP_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5432/ecom_merchant'

const isProd = process.env.NODE_ENV === 'production'

export const connection = postgres(DATABASE_URL, {
  max: 10,
  // Bound worst-case query time so one slow analytics query cannot pin the pool.
  connection: { statement_timeout: 30_000, idle_in_transaction_session_timeout: 30_000 },
  ...(isProd ? { ssl: 'require' as const } : {})
})

export const db = drizzle(connection, { schema })

export type DB = typeof db
