import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq, inArray, like } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { merchants, stockTransfers, warehouseInventory, warehouses } from '../src/database/schema'

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

const auth = async (email = 'admin@acme.com') => {
  const res = await call('/api/auth/login', json({ email, password: 'password123' }))
  return { authorization: `Bearer ${res.body.data.accessToken}` }
}

let merchantId: string
let variantId: string
let whA: any
let whB: any
let transferId: string

describe('Warehouse transfers — list & detail enrichment', () => {
  beforeAll(async () => {
    const [merchant] = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.slug, 'acme-store'))
    merchantId = merchant.id

    const list = await call('/api/store/acme-store/products?limit=100')
    const product = list.body.data.items.find((i: any) => i.stock >= 20)
    const detail = await call(`/api/store/acme-store/products/${product.slug}`)
    variantId = detail.body.data.variants[0].id

    const headers = await auth()
    whA = (await call('/api/warehouses', apiJson(headers, { name: 'Tr Source', code: 'TRSRC', isDefault: false }))).body.data
    whB = (await call('/api/warehouses', apiJson(headers, { name: 'Tr Dest', code: 'TRDST', isDefault: false }))).body.data

    await call(`/api/warehouses/${whA.id}/inventory`, apiPut(headers, { variantId, quantity: 50 }))
    await call(`/api/warehouses/${whB.id}/inventory`, apiPut(headers, { variantId, quantity: 0 }))

    const res = await call(
      '/api/transfers',
      apiJson(headers, { fromWarehouseId: whA.id, toWarehouseId: whB.id, variantId, quantity: 5 })
    )
    expect(res.status).toBe(200)

    const [tr] = await db.select({ id: stockTransfers.id }).from(stockTransfers).where(and(eq(stockTransfers.fromWarehouseId, whA.id), eq(stockTransfers.toWarehouseId, whB.id)))
    transferId = tr.id
  })

  it('returns an enriched transfer list with warehouse and product names', async () => {
    const headers = await auth()
    const res = await call('/api/transfers', { headers })
    expect(res.status).toBe(200)
    const items = res.body.data.items

    const t = items.find((x: any) => x.id === transferId)
    expect(t).toBeDefined()
    expect(t.sourceName).toBe('Tr Source')
    expect(t.destinationName).toBe('Tr Dest')
    expect(t.productName).toBeTruthy()
    expect(t.quantity).toBe(5)
  })

  it('returns a single enriched transfer by id', async () => {
    const headers = await auth()
    const res = await call(`/api/transfers/${transferId}`, { headers })
    expect(res.status).toBe(200)
    const t = res.body.data
    expect(t.id).toBe(transferId)
    expect(t.sourceName).toBe('Tr Source')
    expect(t.destinationName).toBe('Tr Dest')
    expect(t.productName).toBeTruthy()
    expect(t.variantId).toBe(variantId)
  })

  it('returns warehouse inventory enriched with SKU counts and stock value', async () => {
    const headers = await auth()
    const res = await call(`/api/warehouses/${whA.id}/inventory`, { headers })
    expect(res.status).toBe(200)
    expect(res.body.data.warehouse.name).toBe('Tr Source')
    expect(res.body.data.skuCount).toBeGreaterThanOrEqual(1)
    expect(res.body.data.items.length).toBeGreaterThanOrEqual(1)
    expect(res.body.data.items.some((i: any) => i.variantId === variantId && i.quantity === 45)).toBe(true)
    expect(res.body.data.stockValue).toBeGreaterThanOrEqual(0)
  })

  it('returns 404 for an unknown transfer', async () => {
    const headers = await auth()
    const res = await call('/api/transfers/nonexistent', { headers })
    expect(res.status).toBe(404)
  })

  afterAll(async () => {
    await db.delete(stockTransfers).where(eq(stockTransfers.merchantId, merchantId))
    await db.delete(warehouseInventory).where(and(eq(warehouseInventory.merchantId, merchantId), inArray(warehouseInventory.warehouseId, [whA.id, whB.id])))
    await db.delete(warehouses).where(and(eq(warehouses.merchantId, merchantId), like(warehouses.code, 'TR%')))
  })
})