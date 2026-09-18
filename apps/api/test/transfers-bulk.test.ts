import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq, inArray, like } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import {
  merchants,
  products,
  productVariants,
  stockTransfers,
  warehouseInventory,
  warehouses
} from '../src/database/schema'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const body = await res.json()
  return { status: res.status, body }
}

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
})

const apiJson = (headers: Record<string, string>, body: unknown) => ({
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify(body)
})

const apiPut = (headers: Record<string, string>, body: unknown) => ({
  method: 'PUT',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify(body)
})

const auth = async (email = 'admin@jamicore.com') => {
  const res = await call('/api/auth/login', json({ email, password: 'password123' }))
  return { authorization: `Bearer ${res.body.data.accessToken}` }
}

let merchantId: string
let whA: any
let whB: any
let variantA: { id: string; inventory: number }
let variantB: { id: string; inventory: number }
let foreignVariantId: string
let foreignProductId: string
const groupKeys: string[] = []
const stamp = Date.now()

const stockOf = async (warehouseId: string, variantId: string) => {
  const [row] = await db
    .select({ quantity: warehouseInventory.quantity })
    .from(warehouseInventory)
    .where(and(eq(warehouseInventory.warehouseId, warehouseId), eq(warehouseInventory.variantId, variantId)))
  return row?.quantity ?? 0
}

describe('Warehouse transfers — pool fallback, bulk & tenant safety', () => {
  beforeAll(async () => {
    const [merchant] = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.slug, 'jamicore-store'))
    merchantId = merchant.id

    const seeded = await db
      .select({ id: productVariants.id, inventory: productVariants.inventory })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(and(eq(products.merchantId, merchantId), eq(products.status, 'active')))
      .orderBy(productVariants.inventory)
    const candidates = seeded.filter((v) => v.inventory >= 12)
    variantA = candidates[0] ?? seeded[0]
    variantB = candidates[1] ?? seeded[1] ?? seeded[0]

    // A second merchant + product + variant to assert tenant isolation.
    await db
      .insert(merchants)
      .values({ name: 'Other Bulk Store', slug: `other-bulk-${stamp}`, email: `bulk-other-${stamp}@example.com` })
      .onConflictDoNothing()
    const [foreignMerchant] = await db
      .select({ id: merchants.id })
      .from(merchants)
      .where(eq(merchants.slug, `other-bulk-${stamp}`))
    const [foreignProduct] = await db
      .insert(products)
      .values({
        merchantId: foreignMerchant.id,
        name: 'Foreign Widget',
        slug: `foreign-widget-${stamp}`,
        price: 9.99,
        status: 'active'
      })
      .returning()
    foreignProductId = foreignProduct.id
    const [foreignVariant] = await db
      .insert(productVariants)
      .values({ productId: foreignProduct.id, sku: `FOREIGN-${stamp}`, price: 9.99, inventory: 30 })
      .returning()
    foreignVariantId = foreignVariant.id

    const headers = await auth()
    whA = (await call('/api/warehouses', apiJson(headers, { name: 'Bulk Source', code: 'TBSRC', isDefault: false }))).body.data
    whB = (await call('/api/warehouses', apiJson(headers, { name: 'Bulk Dest', code: 'TBDST', isDefault: false }))).body.data
  })

  it('moves stock out of the unallocated global pool when the source has no row', async () => {
    const headers = await auth()
    expect(await stockOf(whA.id, variantA.id)).toBe(0)

    const res = await call(
      '/api/transfers',
      apiJson(headers, { fromWarehouseId: whA.id, toWarehouseId: whB.id, variantId: variantA.id, quantity: 5 })
    )
    expect(res.status).toBe(200)
    expect(res.body.data.kind).toBe('manual')
    expect(await stockOf(whB.id, variantA.id)).toBe(5)
    expect(await stockOf(whA.id, variantA.id)).toBe(0)
  })

  it('re-computes the pool after an allocation exists elsewhere (no double spend)', async () => {
    const headers = await auth()
    const res = await call(
      '/api/transfers',
      apiJson(headers, { fromWarehouseId: whA.id, toWarehouseId: whB.id, variantId: variantA.id, quantity: 5 })
    )
    expect(res.status).toBe(200)
    expect(await stockOf(whB.id, variantA.id)).toBe(10)
  })

  it('rejects a transfer that exceeds the available pool', async () => {
    const headers = await auth()
    const available = variantA.inventory - 10
    const res = await call(
      '/api/transfers',
      apiJson(headers, { fromWarehouseId: whA.id, toWarehouseId: whB.id, variantId: variantA.id, quantity: available + 100 })
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK')
    expect(await stockOf(whB.id, variantA.id)).toBe(10)
  })

  it('returns VARIANT_NOT_FOUND for an unknown variant', async () => {
    const headers = await auth()
    const res = await call(
      '/api/transfers',
      apiJson(headers, { fromWarehouseId: whA.id, toWarehouseId: whB.id, variantId: 'does-not-exist', quantity: 1 })
    )
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('VARIANT_NOT_FOUND')
  })

  it('isolates variants owned by another merchant (RLS hides them → not found)', async () => {
    const headers = await auth()
    const res = await call(
      '/api/transfers',
      apiJson(headers, { fromWarehouseId: whA.id, toWarehouseId: whB.id, variantId: foreignVariantId, quantity: 1 })
    )
    // Tenant isolation is enforced by row-level security: a foreign variant is
    // simply invisible, surfacing as VARIANT_NOT_FOUND rather than touching it.
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('VARIANT_NOT_FOUND')
  })

  it('bulk-transfers multiple explicit lines atomically and shares a groupKey', async () => {
    const headers = await auth()
    await call(`/api/warehouses/${whA.id}/inventory`, apiPut(headers, { variantId: variantA.id, quantity: 12 }))
    await call(`/api/warehouses/${whA.id}/inventory`, apiPut(headers, { variantId: variantB.id, quantity: 7 }))

    const res = await call(
      '/api/transfers/bulk',
      apiJson(headers, {
        fromWarehouseId: whA.id,
        toWarehouseId: whB.id,
        items: [
          { variantId: variantA.id, quantity: 5 },
          { variantId: variantB.id, quantity: 4 }
        ]
      })
    )
    expect(res.status).toBe(200)
    expect(res.body.data.groupKey).toBeTruthy()
    expect(res.body.data.lineCount).toBe(2)
    expect(res.body.data.kind).toBe('bulk')
    groupKeys.push(res.body.data.groupKey)

    expect(await stockOf(whA.id, variantA.id)).toBe(7)
    expect(await stockOf(whA.id, variantB.id)).toBe(3)
    expect(await stockOf(whB.id, variantA.id)).toBe(15)
    expect(await stockOf(whB.id, variantB.id)).toBe(4)

    const rows = await db
      .select({ kind: stockTransfers.kind, groupKey: stockTransfers.groupKey })
      .from(stockTransfers)
      .where(eq(stockTransfers.groupKey, res.body.data.groupKey))
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.kind === 'bulk')).toBe(true)
  })

  it('bulk "transfer all stock" moves every held item with its full quantity', async () => {
    const headers = await auth()
    await call(`/api/warehouses/${whA.id}/inventory`, apiPut(headers, { variantId: variantB.id, quantity: 3 }))

    const res = await call(
      '/api/transfers/bulk',
      apiJson(headers, { fromWarehouseId: whA.id, toWarehouseId: whB.id, allStock: true })
    )
    expect(res.status).toBe(200)
    expect(res.body.data.lineCount).toBeGreaterThanOrEqual(1)
    expect(res.body.data.kind).toBe('bulk')
    groupKeys.push(res.body.data.groupKey)

    expect(await stockOf(whA.id, variantA.id)).toBe(0)
    expect(await stockOf(whA.id, variantB.id)).toBe(0)
    expect(await stockOf(whB.id, variantB.id)).toBe(7)
  })

  it('rolls back the whole batch when a single line is short', async () => {
    const headers = await auth()
    await call(`/api/warehouses/${whA.id}/inventory`, apiPut(headers, { variantId: variantB.id, quantity: 25 }))
    const beforeA = await stockOf(whB.id, variantA.id)
    const beforeB = await stockOf(whB.id, variantB.id)

    const res = await call(
      '/api/transfers/bulk',
      apiJson(headers, {
        fromWarehouseId: whA.id,
        toWarehouseId: whB.id,
        items: [
          { variantId: variantA.id, quantity: 1 },
          { variantId: variantB.id, quantity: 9999 }
        ]
      })
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK')
    expect(await stockOf(whB.id, variantB.id)).toBe(beforeB)
    expect(await stockOf(whB.id, variantA.id)).toBe(beforeA)
  })

  it('returns 404 for the source warehouse when absent', async () => {
    const headers = await auth()
    const res = await call(
      '/api/transfers',
      apiJson(headers, { fromWarehouseId: 'nowhere', toWarehouseId: whB.id, variantId: variantA.id, quantity: 1 })
    )
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('WAREHOUSE_NOT_FOUND')
  })

  afterAll(async () => {
    await db.delete(stockTransfers).where(eq(stockTransfers.merchantId, merchantId))
    await db.delete(warehouseInventory).where(and(eq(warehouseInventory.merchantId, merchantId), inArray(warehouseInventory.warehouseId, [whA.id, whB.id])))
    await db.delete(warehouses).where(and(eq(warehouses.merchantId, merchantId), like(warehouses.code, 'TB%')))
    await db.delete(productVariants).where(eq(productVariants.id, foreignVariantId))
    await db.delete(products).where(eq(products.id, foreignProductId))
    await db.delete(merchants).where(eq(merchants.slug, `other-bulk-${stamp}`))
  })
})