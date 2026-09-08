import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import {
  billOfMaterials,
  bomItems,
  inventoryLogs,
  merchants,
  productVariants,
  productionOrderItems,
  productionOrders,
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

const auth = async (email = 'admin@acme.com') => {
  const res = await call('/api/auth/login', json({ email, password: 'password123' }))
  return { authorization: `Bearer ${res.body.data.accessToken}` }
}

const apiGet = (headers: Record<string, string>) => ({ method: 'GET', headers })
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

let merchantId: string
let componentVariantId: string
let outputVariantId: string
let bomId: string
let outletBatchId: string
let batchIds: string[] = []
let warehouseId: string
let componentBaseline = 0
let outputBaseline = 0

describe('Production: BOMs and production orders (merchant-wide)', () => {
  beforeAll(async () => {
    const [merchant] = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.slug, 'acme-store'))
    merchantId = merchant.id

    // Discover two stocked variants: one to consume, one to produce.
    const headers = await auth()
    warehouseId = (await call('/api/warehouses', apiJson(headers, { name: 'Prod Wh', code: 'PRODWH', isDefault: true }))).body.data.id

    const list = await call('/api/store/acme-store/products?limit=100')
    const productsArr = list.body.data.items as Array<{ slug: string; stock: number }>
    const compProduct = productsArr.find((i: any) => i.stock >= 10)
    if (!compProduct) throw new Error('no stocked product found')
    const compDetail = await call(`/api/store/acme-store/products/${compProduct.slug}`)
    componentVariantId = compDetail.body.data.variants[0].id

    const outProduct = productsArr.find((i: any) => i.slug !== compProduct.slug)
    if (!outProduct) throw new Error('no second product found')
    const outDetail = await call(`/api/store/acme-store/products/${outProduct.slug}`)
    outputVariantId = outDetail.body.data.variants[0].id

    const [c] = await db.select({ inventory: productVariants.inventory }).from(productVariants).where(eq(productVariants.id, componentVariantId))
    const [o] = await db.select({ inventory: productVariants.inventory }).from(productVariants).where(eq(productVariants.id, outputVariantId))
    componentBaseline = c.inventory
    outputBaseline = o.inventory
  })

  afterAll(async () => {
    // Restore ledgers consumed/produced by this suite.
    await db.update(productVariants).set({ inventory: componentBaseline }).where(eq(productVariants.id, componentVariantId))
    await db.update(productVariants).set({ inventory: outputBaseline }).where(eq(productVariants.id, outputVariantId))

    await db.delete(warehouseInventory).where(eq(warehouseInventory.merchantId, merchantId))
    if (warehouseId) await db.delete(warehouses).where(eq(warehouses.id, warehouseId))
    const batcheRowIds = await db.select({ productionOrderId: productionOrderItems.productionOrderId }).from(productionOrderItems)
    const orderIds = new Set(batcheRowIds.map((r) => r.productionOrderId))
    if (orderIds.size) await db.delete(productionOrderItems).where(inArray(productionOrderItems.productionOrderId, Array.from(orderIds)))
    if (batchIds.length) await db.delete(productionOrders).where(inArray(productionOrders.id, batchIds))
    const bomRows = await db.select({ id: billOfMaterials.id }).from(billOfMaterials).where(eq(billOfMaterials.merchantId, merchantId))
    const bomIds = bomRows.map((r) => r.id)
    if (bomIds.length) await db.delete(bomItems).where(inArray(bomItems.bomId, bomIds))
    if (bomIds.length) await db.delete(billOfMaterials).where(inArray(billOfMaterials.id, bomIds))
    await db.delete(inventoryLogs).where(and(eq(inventoryLogs.merchantId, merchantId), eq(inventoryLogs.reason, 'production')))
  })

  it('creates a draft BOM from two stockable variants', async () => {
    const headers = await auth()
    const res = await call(
      '/api/boms',
      apiJson(headers, {
        name: 'Gift Bundle',
        outputVariantId,
        outputQuantity: 1,
        notes: 'Bundles one unit into the output',
        items: [{ variantId: componentVariantId, quantity: 2 }]
      })
    )
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('draft')
    expect(res.body.data.name).toBe('Gift Bundle')
    bomId = res.body.data.id

    const detail = await call(`/api/boms/${bomId}`, apiGet(headers))
    expect(detail.body.data.items.length).toBe(1)
    expect(detail.body.data.items[0].quantity).toBe(2)
    expect(detail.body.data.output?.sku).toBeTruthy()
  })

  it('rejects a self-consuming BOM', async () => {
    const headers = await auth()
    const res = await call(
      '/api/boms',
      apiJson(headers, {
        name: 'Invalid Self BOM',
        outputVariantId,
        items: [{ variantId: outputVariantId, quantity: 1 }]
      })
    )
    expect(res.status).toBe(400)
  })

  it('rejects BOM creation without inventory permissions (403)', async () => {
    const headers = await auth('riley@acme.com')
    const res = await call('/api/boms', apiJson(headers, { name: 'Nope', outputVariantId, items: [{ variantId: componentVariantId, quantity: 1 }] }))
    expect(res.status).toBe(403)
  })

  it('activates a draft BOM and locks component edits', async () => {
    const headers = await auth()
    const activated = await call(`/api/boms/${bomId}`, apiPut(headers, { status: 'active' }))
    expect(activated.body.data.status).toBe('active')

    // After activation the component list is frozen.
    const locked = await call(`/api/boms/${bomId}`, apiPut(headers, { items: [{ variantId: componentVariantId, quantity: 5 }] }))
    expect(locked.status).toBe(409)
  })

  it('cannot produce against a draft BOM', async () => {
    const headers = await auth()
    const draftBom = (await call(
      '/api/boms',
      apiJson(headers, { name: 'Draft BOM', outputVariantId, items: [{ variantId: componentVariantId, quantity: 1 }] })
    )).body.data
    const res = await call('/api/production-orders', apiJson(headers, { bomId: draftBom.id, quantity: 1 }))
    expect(res.status).toBe(409)

    const bomRows = await db.select({ id: billOfMaterials.id }).from(billOfMaterials).where(eq(billOfMaterials.id, draftBom.id))
    if (bomRows.length) {
      await db.delete(bomItems).where(eq(bomItems.bomId, draftBom.id))
      await db.delete(billOfMaterials).where(eq(billOfMaterials.id, draftBom.id))
    }
  })

  it('creates and starts a production order', async () => {
    const headers = await auth()
    const res = await call('/api/production-orders', apiJson(headers, { bomId, quantity: 3, notes: 'Batch of 3' }))
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('planned')
    expect(res.body.data.productionNumber.startsWith('#PR')).toBe(true)
    batchIds.push(res.body.data.id)
    outletBatchId = res.body.data.id

    const started = await call(`/api/production-orders/${res.body.data.id}/start`, apiJson(headers, {}))
    expect(started.status).toBe(200)
    expect(started.body.data.status).toBe('in_progress')
    expect(started.body.data.startedAt).toBeTruthy()
  })

  it('refuses to complete when components are insufficient', async () => {
    const headers = await auth()

    // Build a second, active BOM that needs more than the component stock.
    const bom = (await call(
      '/api/boms',
      apiJson(headers, { name: 'Greedy BOM', outputVariantId, items: [{ variantId: componentVariantId, quantity: 10_000 }] })
    )).body.data
    await call(`/api/boms/${bom.id}`, apiPut(headers, { status: 'active' }))
    const order = (await call('/api/production-orders', apiJson(headers, { bomId: bom.id, quantity: 1 }))).body.data
    batchIds.push(order.id)

    const res = await call(`/api/production-orders/${order.id}/complete`, apiJson(headers, {}))
    expect(res.status).toBe(400)

    // Cleanup the greedy fixtures.
    const bomItemsToDelete = await db.select({ id: bomItems.id }).from(bomItems).where(eq(bomItems.bomId, bom.id))
    if (bomItemsToDelete.length) await db.delete(bomItems).where(inArray(bomItems.id, bomItemsToDelete.map((x) => x.id)))
    await db.delete(productionOrders).where(eq(productionOrders.id, order.id))
    await db.delete(billOfMaterials).where(eq(billOfMaterials.id, bom.id))
    batchIds = batchIds.filter((x) => x !== order.id)
  })

  it('completes the order and moves stock atomically', async () => {
    const headers = await auth()
    const [before] = await db.select({ inventory: productVariants.inventory }).from(productVariants).where(eq(productVariants.id, componentVariantId))

    const res = await call(`/api/production-orders/${outletBatchId}/complete`, apiJson(headers, { warehouseId }))
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('completed')
    expect(res.body.data.outputQuantity).toBe(3)

    // Component consumed: 2 × 3 = 6 units from the global ledger.
    const [after] = await db.select({ inventory: productVariants.inventory }).from(productVariants).where(eq(productVariants.id, componentVariantId))
    expect(after.inventory).toBe(before.inventory - 6)

    // Output produced: 1 × 3 = 3 units.
    const [out] = await db.select({ inventory: productVariants.inventory }).from(productVariants).where(eq(productVariants.id, outputVariantId))
    expect(out.inventory).toBe(outputBaseline + 3)

    // Audit log entries (reason production, reference = the batch number).
    const logs = await db
      .select()
      .from(inventoryLogs)
      .where(and(eq(inventoryLogs.merchantId, merchantId), eq(inventoryLogs.reason, 'production')))
    expect(logs.length).toBe(2)
    const compLog = logs.find((l) => l.variantId === componentVariantId)
    const outLog = logs.find((l) => l.variantId === outputVariantId)
    expect(compLog?.change).toBe(-6)
    expect(outLog?.change).toBe(3)
    expect(compLog?.reference).toBe(outLog?.reference)
    expect(compLog?.reference?.startsWith('#PR')).toBe(true)

    // Warehouse mirror: component was not stocked in the warehouse (no row → skipped
    // like the checkout path), output stocked 3.
    const [whComp] = await db
      .select({ quantity: warehouseInventory.quantity })
      .from(warehouseInventory)
      .where(and(eq(warehouseInventory.warehouseId, warehouseId), eq(warehouseInventory.variantId, componentVariantId)))
    expect(whComp?.quantity ?? 0).toBe(0)
    const [whOut] = await db
      .select({ quantity: warehouseInventory.quantity })
      .from(warehouseInventory)
      .where(and(eq(warehouseInventory.warehouseId, warehouseId), eq(warehouseInventory.variantId, outputVariantId)))
    expect(whOut.quantity).toBe(3)

    // Scorecard snapshot persisted with before/after values.
    const detail = await call(`/api/production-orders/${outletBatchId}`, apiGet(headers))
    expect(detail.body.data.status).toBe('completed')
    const scoreItems = detail.body.data.items
    expect(scoreItems.length).toBe(2)
    const compRow = scoreItems.find((i: any) => i.variantId === componentVariantId)
    expect(compRow?.change).toBe(-6)
    expect(compRow?.beforeValue).toBe(before.inventory)
    expect(compRow?.afterValue).toBe(before.inventory - 6)
  })

  it('cannot complete again or cancel a completed order', async () => {
    const headers = await auth()
    const again = await call(`/api/production-orders/${outletBatchId}/complete`, apiJson(headers, {}))
    expect(again.status).toBe(409)
    const cancel = await call(`/api/production-orders/${outletBatchId}/cancel`, apiJson(headers, {}))
    expect(cancel.status).toBe(409)
  })

  it('cancels a planned order without touching inventory', async () => {
    const headers = await auth()
    const order = (await call('/api/production-orders', apiJson(headers, { bomId, quantity: 1 }))).body.data
    batchIds.push(order.id)
    const res = await call(`/api/production-orders/${order.id}/cancel`, apiJson(headers, {}))
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('cancelled')
  })

  it('lists BOMs and production orders', async () => {
    const headers = await auth()
    const boms = await call('/api/boms', apiGet(headers))
    expect(boms.status).toBe(200)
    expect(boms.body.data.items.some((b: any) => b.id === bomId)).toBe(true)

    const orders = await call('/api/production-orders', apiGet(headers))
    expect(orders.status).toBe(200)
    const mine = orders.body.data.items.find((o: any) => o.id === outletBatchId)
    expect(mine?.status).toBe('completed')
    expect(mine?.bomName).toBe('Gift Bundle')
  })
})