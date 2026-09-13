import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from './schema'
import type { DB } from './client'

/**
 * Connection string for the tenant-scoped runtime role (`app_runtime`).
 * This role must NOT be BYPASSRLS so Row Level Security actually filters rows.
 * When unset, falls back to DATABASE_URL — in that case requests bypass RLS,
 * so production must always configure APP_RUNTIME_DATABASE_URL explicitly.
 */
export const RUNTIME_DATABASE_URL =
  process.env.APP_RUNTIME_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5432/ecom_merchant'

export interface TenantConnection {
  db: DB
  end: () => Promise<void>
}

/**
 * Open a dedicated one-connection pool for a single merchant and pin the
 * session to that merchant's id via `app.current_merchant_id`. Every query on
 * `db` then runs under Row Level Security filtered to that merchant.
 *
 * A fresh connection per request (closed after the response) makes the
 * session-level SET safe — the setting never leaks to another request, which
 * is why a request-scoped connection is used instead of mutating the global
 * pool from `client.ts`.
 *
 * `idle_timeout` reaps the socket server-side if the request-scoped `end()`
 * never runs (e.g. a lifecycle path that skips the plugin close hooks), so a
 * missed close degrades to a bounded 10s socket instead of exhausting the
 * database connection pool.
 */
export const createTenantConnection = async (merchantId: string): Promise<TenantConnection> => {
  const connection = postgres(RUNTIME_DATABASE_URL, { max: 1, idle_timeout: 10 })
  // SET does not accept bind parameters, so use set_config (parameterized).
  // is_local=false keeps the value for the whole session — safe because the
  // connection is dedicated to a single request and closed afterwards.
  await connection`SELECT set_config('app.current_merchant_id', ${merchantId}, false)`
  return {
    db: drizzle(connection, { schema }),
    end: async () => {
      await connection.end({ timeout: 5 })
    }
  }
}

/**
 * Run a callback with a request-scoped tenant connection, guaranteeing the
 * connection is closed afterwards. Used by webhook/callback handlers that
 * resolve the merchant from the payload rather than a JWT.
 */
export const withTenantContext = async <T>(
  merchantId: string,
  fn: (db: DB) => Promise<T>
): Promise<T> => {
  const tenancy = await createTenantConnection(merchantId)
  try {
    return await fn(tenancy.db)
  } finally {
    await tenancy.end()
  }
}

/**
 * Run a callback inside a transaction with the tenant id set via SET LOCAL.
 * SET LOCAL lasts only for the transaction, so even an aborted transaction
 * cannot leak the merchant setting to a pooled connection.
 */
export const withTenantTransaction = async <T>(
  merchantId: string,
  fn: (tx: DB) => Promise<T>
): Promise<T> => {
  const connection = postgres(RUNTIME_DATABASE_URL, { max: 1, idle_timeout: 10 })
  try {
    const tenantDb = drizzle(connection, { schema })
    return await tenantDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_merchant_id', ${merchantId}, true)`)
      return fn(tx as unknown as DB)
    })
  } finally {
    await connection.end({ timeout: 5 })
  }
}