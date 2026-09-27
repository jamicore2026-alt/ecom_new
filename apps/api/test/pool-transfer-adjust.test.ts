import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { inventoryLogs, merchants, productVariants, products, warehouseInventory, warehouses } from '../src/database/schema'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

const json = (body: unknown, token?: string) => ({
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {})
  },
  body: JSON.stringify(body)
})

const stamp = Date.now()
let adminToken = ''
let merchantId = ''
let variantId = ''
let productId = ''
let destId = ''
const cleanupWarehouseIds: string[] = []

describe('Pool-source transfers + warehouse-scoped adjustments', () => {
  beforeAll(async () => {
    const login = await call('/api/auth/login', json({ email: 'admin@jamicore.com', password: 'password123' }))
    adminToken = login.body.data.accessToken
    const [merchant] = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.slug, 'jamicore-store'))
    merchantId = merchant.id
    const headers = { authorization: `Bearer ${adminToken}` }

    const prod = await call(
      '/api/products',
      json({ sku: `POOL-${stamp}`, name: 'Pool Transfer Item', price: 3, status: 'active', variants: [{ sku: `POOL-${stamp}-V`, optionValues: {}, inventory: 20 }] }, adminToken)
    )
    expect(prod.status).toBe(200)
    productId = prod.body.data.id
    const detail = await call(`/api/products/${productId}`, { headers })
    variantId = detail.body.data.variants[0].id

    const dest = await call('/api/warehouses', json({ name: 'Pool Dest', code: `PLD${stamp}`.slice(-30) }, adminToken))
    expect(dest.status).toBe(200)
    destId = dest.body.data.id
    cleanupWarehouseIds.push(destId)
  })

  afterAll(async () => {
    if (productId) await db.delete(products).where(and(eq(products.id, productId), eq(products.merchantId, merchantId))).catch(() => null)
    for (const id of cleanupWarehouseIds) {
      await db.delete(warehouseInventory).where(eq(warehouseInventory.warehouseId, id)).catch(() => null)
      await db.delete(warehouses).where(eq(warehouses.id, id)).catch(() => null)
    }
  })

  const auth = () => ({ authorization: `Bearer ${adminToken}` })

  it('transfers from the global pool when source is omitted', async () => {
    const res = await call(
      '/api/transfers',
      json({ fromWarehouseId: null, toWarehouseId: destId, variantId, quantity: 5 }, adminToken)
    )
    expect(res.status).toBe(200)

    const [variant] = await db.select().from(productVariants).where(eq(productVariants.id, variantId))
    expect(variant.inventory).toBe(15)
    const [row] = await db
      .select()
      .from(warehouseInventory)
      .where(and(eq(warehouseInventory.warehouseId, destId), eq(warehouseInventory.variantId, variantId)))
    expect(row.quantity).toBe(5)
  })

  it('rejects pool-source transfers beyond the unallocated pool', async () => {
    const res = await call(
      '/api/transfers',
      json({ fromWarehouseId: null, toWarehouseId: destId, variantId, quantity: 9999 }, adminToken)
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK')
  })

  it('creates deferred pool-source transfers and receives them', async () => {
    const created = await call(
      '/api/transfers',
      json({ fromWarehouseId: null, toWarehouseId: destId, variantId, quantity: 2, deferred: true }, adminToken)
    )
    expect(created.status).toBe(200)
    expect(created.body.data.status).toBe('in_transit')

    const [before] = await db.select().from(productVariants).where(eq(productVariants.id, variantId))
    const received = await call(`/api/transfers/${created.body.data.id}/receive`, {
      method: 'POST',
      headers: auth()
    })
    expect(received.status).toBe(200)
    const [after] = await db.select().from(productVariants).where(eq(productVariants.id, variantId))
    expect(after.inventory).toBe(before.inventory - 2)
  })

  it('adjusts a warehouse leg with global mirror, actor and history', async () => {
    const res = await call(
      `/api/inventory/${variantId}/adjust`,
      json({ change: 4, reason: 'damage', warehouseId: destId }, adminToken)
    )
    expect(res.status).toBe(200)

    const [variant] = await db.select().from(productVariants).where(eq(productVariants.id, variantId))
    const [row] = await db
      .select()
      .from(warehouseInventory)
      .where(and(eq(warehouseInventory.warehouseId, destId), eq(warehouseInventory.variantId, variantId)))
    // +5 pool transfer, +2 deferred receive, +4 adjust (from 20 global)
    expect(row.quantity).toBe(5 + 2 + 4)
    expect(variant.inventory).toBe(20 - 5 - 2 + 4)

    const [log] = await db
      .select()
      .from(inventoryLogs)
      .where(and(eq(inventoryLogs.variantId, variantId), eq(inventoryLogs.reason, 'damage')))
    expect(log.reference).toBe(destId)
    expect(log.actorName).toBeTruthy()

    const history = await call(`/api/inventory/history?variantId=${variantId}`, { headers: auth() })
    expect(history.status).toBe(200)
    const entry = history.body.data.items.find((h: any) => h.reason === 'damage')
    expect(entry).toBeDefined()
    expect(entry.actorName).toBeTruthy()
    expect(entry.warehouseName).toBe('Pool Dest')
  })

  it('rejects warehouse reductions below zero on either leg', async () => {
    const res = await call(
      `/api/inventory/${variantId}/adjust`,
      json({ change: -9999, reason: 'correction', warehouseId: destId }, adminToken)
    )
    expect(res.status).toBe(400)
  })

  it('rejects adjustments for unknown warehouses', async () => {
    const res = await call(
      `/api/inventory/${variantId}/adjust`,
      json({ change: 1, reason: 'correction', warehouseId: 'nope-nope' }, adminToken)
    )
    expect(res.status).toBe(404)
  })

  it('exposes per-warehouse breakdown on inventory rows', async () => {
    const res = await call(`/api/inventory?search=POOL-${stamp}`, { headers: auth() })
    expect(res.status).toBe(200)
    const row = res.body.data.items.find((r: any) => r.id === variantId)
    expect(row).toBeDefined()
    expect(Array.isArray(row.warehouses)).toBe(true)
    expect(row.warehouses.some((w: any) => w.id === destId)).toBe(true)
  })
})
