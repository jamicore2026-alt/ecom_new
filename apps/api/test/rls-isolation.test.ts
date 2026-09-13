import { beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import { connection, db } from '../src/database/client'
import { merchants } from '../src/database/schema'

/**
 * DB-level RLS isolation guarantee (audit/RLS.md).
 *
 * Connects as `app_runtime` (the no-BYPASSRLS tenant role) and proves:
 *  - without `app.current_merchant_id` set, no tenant rows are visible;
 *  - with it set, only that merchant's rows are visible / writable;
 *  - cross-tenant writes are rejected or no-op'd by the row policies;
 *  - `app_admin` (used by bootstrap/background work) is the BYPASSRLS role.
 */
let merchantA: string
let merchantB: string
const orderA = 'ord_rls_a1'
const orderB = 'ord_rls_b1'

/**
 * Resolve the tenant (app_runtime) URL. Tests run with cwd apps/api, so the
 * repo-root .env is not auto-loaded by Bun — locate it manually. Without a
 * real app_runtime connection the fallback is a BYPASSRLS superuser, which
 * would silently pretend RLS is proven when it isn't, so fail loudly instead.
 */
function runtimeUrl(): string {
  if (process.env.APP_RUNTIME_DATABASE_URL) return process.env.APP_RUNTIME_DATABASE_URL
  let dir = process.cwd()
  for (let i = 0; i < 6; i += 1) {
    const file = path.join(dir, '.env')
    if (existsSync(file)) {
      const line = readFileSync(file, 'utf8')
        .split('\n')
        .find((l) => /^APP_RUNTIME_DATABASE_URL=/.test(l))
      if (line) return line.replace(/^APP_RUNTIME_DATABASE_URL=/, '')
    }
    dir = path.dirname(dir)
  }
  throw new Error('RLS isolation test needs APP_RUNTIME_DATABASE_URL (the non-BYPASSRLS role)')
}

const connect = () => postgres(runtimeUrl(), { max: 1 })

beforeAll(async () => {
  // Idempotent across repeated runs against the same database: clear orphaned
  // rows from any previous run before seeding fresh ones.
  await connection.unsafe(
    `DELETE FROM orders WHERE id IN ('ord_rls_a1', 'ord_rls_a2', 'ord_rls_b1', 'ord_rls_leak')`
  )
  await connection.unsafe(`DELETE FROM merchants WHERE slug = 'rls-second-store'`)

  const [a] = await db.select().from(merchants).where(eq(merchants.slug, 'jamicore-store'))
  merchantA = a.id

  const [b] = await db
    .insert(merchants)
    .values({
      name: 'RLS Second Merchant',
      slug: 'rls-second-store',
      email: 'rls-second@example.com'
    })
    .returning()
  merchantB = b.id

  // Seed one order per merchant through the admin (BYPASSRLS) connection.
  await connection.unsafe(`
    INSERT INTO orders (id, merchant_id, order_number)
    VALUES ('${orderA}', '${merchantA}', 'ORD-RLS-A'), ('${orderB}', '${merchantB}', 'ORD-RLS-B')
  `)
})

describe('RLS roles', () => {
  it('locks the tenant role out of BYPASSRLS', async () => {
    const [appRuntime] = await connection.unsafe<{ rolbypassrls: boolean }[]>(
      `SELECT rolbypassrls FROM pg_roles WHERE rolname = 'app_runtime'`
    )
    const [appAdmin] = await connection.unsafe<{ rolbypassrls: boolean }[]>(
      `SELECT rolbypassrls FROM pg_roles WHERE rolname = 'app_admin'`
    )
    expect(appRuntime.rolbypassrls).toBe(false)
    expect(appAdmin.rolbypassrls).toBe(true)
  })
})

describe('RLS read isolation', () => {
  it('shows no tenant rows without the merchant context set', async () => {
    const c = connect()
    try {
      const rows = await c<{ id: string }[]>`SELECT id FROM orders`
      expect(rows.length).toBe(0)
    } finally {
      await c.end()
    }
  })

  it('scopes reads to the merchant pinned in the session', async () => {
    const c = connect()
    try {
      await c`SELECT set_config('app.current_merchant_id', ${merchantA}, false)`
      const rows = await c<{ id: string; merchant_id: string }[]>`SELECT id, merchant_id FROM orders`
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.some((r) => r.id === orderA)).toBe(true)
      // Merchant B's order must never be visible from A's session.
      expect(rows.some((r) => r.id === orderB)).toBe(false)
      expect(rows.every((r) => r.merchant_id === merchantA)).toBe(true)
    } finally {
      await c.end()
    }
  })
})

describe('RLS write enforcement', () => {
  it('rejects a cross-tenant insert (WITH CHECK)', async () => {
    const c = connect()
    try {
      await c`SELECT set_config('app.current_merchant_id', ${merchantA}, false)`
      let rejected = false
      try {
        await c`INSERT INTO orders (id, merchant_id, order_number)
                VALUES (${'ord_rls_leak'}, ${merchantB}, ${'ORD-RLS-LEAK'}) RETURNING id`
      } catch {
        rejected = true
      }
      expect(rejected).toBe(true)
    } finally {
      await c.end()
    }
  })

  it('allows an insert inside the pinned merchant scope', async () => {
    const c = connect()
    try {
      await c`SELECT set_config('app.current_merchant_id', ${merchantA}, false)`
      const [row] = await c<{ id: string }[]>`INSERT INTO orders (id, merchant_id, order_number)
               VALUES (${'ord_rls_a2'}, ${merchantA}, ${'ORD-RLS-A2'}) RETURNING id`
      expect(row.id).toBe('ord_rls_a2')
    } finally {
      await c.end()
    }
  })

  it('makes a cross-tenant update a no-op (USING)', async () => {
    const c = connect()
    try {
      await c`SELECT set_config('app.current_merchant_id', ${merchantA}, false)`
      const res = await c`UPDATE orders SET notes = 'nope' WHERE id = ${orderB}`
      expect(Number(res.count)).toBe(0)
    } finally {
      await c.end()
    }
  })
})