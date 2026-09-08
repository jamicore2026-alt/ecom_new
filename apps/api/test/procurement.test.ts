import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import {
  goodsReceiptItems,
  goodsReceipts,
  inventoryLogs,
  merchants,
  productVariants,
  purchaseOrderItems,
  purchaseOrders,
  suppliers,
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
let variantId: string
let variantBaseline = 0
let warehouse: any
let supplier: any
let supplierId: string
let poItemId: string
const poIds: string[] = []
const supplierIds: string[] = []

describe('Procurement: suppliers, purchase orders and goods receipts (merchant-wide)', () => {
  beforeAll(async () => {
    const [merchant] = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.slug, 'acme-store'))
    merchantId = merchant.id

    const headers = await auth()
    warehouse = (await call('/api/warehouses', apiJson(headers, { name: 'Proc Wh', code: 'PROCWH', isDefault: true }))).body.data
    expect(warehouse.id).toBeTruthy()

    supplier = (await call('/api/suppliers', apiJson(headers, { name: 'Fresh Foods Co', contactName: 'Jane', email: 'orders@freshfoods.test', phone: '555' }))).body.data
    expect(supplier.id).toBeTruthy()
    supplierIds.push(supplier.id)
    supplierId = supplier.id

    // A stocked variant to receive against.
    const list = await call('/api/store/acme-store/products?limit=100')
    const product = list.body.data.items.find((i: any) => i.stock >= 10)
    const detail = await call(`/api/store/acme-store/products/${product.slug}`)
    variantId = detail.body.data.variants[0].id
    const [variant] = await db
      .select({ inventory: productVariants.inventory })
      .from(productVariants)
      .where(eq(productVariants.id, variantId))
    variantBaseline = variant.inventory
  })

  afterAll(async () => {
    // Restore global variant stock consumed by receipts in this suite.
    await db
      .update(productVariants)
      .set({ inventory: variantBaseline })
      .where(eq(productVariants.id, variantId))

    // Delete receipts (with items) then their POs (with items) then merchants' rows.
    const receiptRows = await db.select({ id: goodsReceipts.id }).from(goodsReceipts).where(eq(goodsReceipts.merchantId, merchantId))
    const receiptIds = receiptRows.map((r) => r.id)
    if (receiptIds.length) {
      await db.delete(goodsReceiptItems).where(inArray(goodsReceiptItems.goodsReceiptId, receiptIds))
      await db.delete(goodsReceipts).where(inArray(goodsReceipts.id, receiptIds))
    }

    if (poIds.length) {
      await db.delete(purchaseOrderItems).where(inArray(purchaseOrderItems.purchaseOrderId, poIds))
      await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, poIds))
    }

    const poSuppliers = await db.select({ id: purchaseOrders.supplierId }).from(purchaseOrders).where(eq(purchaseOrders.merchantId, merchantId))
    supplierIds.push(...poSuppliers.map((s) => s.id).filter((id): id is string => !!id))

    await db.delete(warehouseInventory).where(eq(warehouseInventory.merchantId, merchantId))
    if (warehouse) await db.delete(warehouses).where(eq(warehouses.id, warehouse.id))
    if (supplierIds.length) await db.delete(suppliers).where(inArray(suppliers.id, Array.from(new Set(supplierIds))))
    await db.delete(inventoryLogs).where(and(eq(inventoryLogs.merchantId, merchantId), eq(inventoryLogs.reason, 'purchase')))
  })

  it('lists suppliers and shows created supplier', async () => {
    const headers = await auth()
    const res = await call('/api/suppliers', apiGet(headers))
    expect(res.status).toBe(200)
    expect(res.body.data.items.length).toBeGreaterThanOrEqual(1)
    const found = res.body.data.items.find((s: any) => s.id === supplier.id)
    expect(found?.email).toBe('orders@freshfoods.test')
  })

  it('rejects supplier creation without inventory permissions (403)', async () => {
    const headers = await auth('riley@acme.com')
    const res = await call('/api/suppliers', apiJson(headers, { name: 'Nope Inc' }))
    expect(res.status).toBe(403)
  })

  it('updates a supplier', async () => {
    const headers = await auth()
    const res = await call(`/api/suppliers/${supplier.id}`, apiPut(headers, { phone: '555-0100', status: 'inactive' }))
    expect(res.status).toBe(200)
    expect(res.body.data.phone).toBe('555-0100')
    expect(res.body.data.status).toBe('inactive')
  })

  it('creates a draft purchase order with items', async () => {
    const headers = await auth()
    const res = await call(
      '/api/purchase-orders',
      apiJson(headers, {
        supplierId,
        notes: 'Restock',
        expectedAt: new Date(Date.now() + 7 * 864e5).toISOString(),
        items: [{ variantId, quantity: 5, unitCost: 12.5 }]
      })
    )
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('draft')
    expect(res.body.data.poNumber.startsWith('#PO')).toBe(true)
    expect(res.body.data.subtotal).toBe(62.5)
    poIds.push(res.body.data.id)

    const detail = await call(`/api/purchase-orders/${res.body.data.id}`, apiGet(headers))
    expect(detail.status).toBe(200)
    expect(detail.body.data.items.length).toBe(1)
    expect(detail.body.data.supplier.name).toBe('Fresh Foods Co')
    expect(detail.body.data.items[0].quantity).toBe(5)
    poItemId = detail.body.data.items[0].id
  })

  it('rejects a draft PO with a quantity of zero', async () => {
    const headers = await auth()
    const res = await call(
      '/api/purchase-orders',
      apiJson(headers, { supplierId, items: [{ variantId, quantity: 0, unitCost: 1 }] })
    )
    expect(res.status).toBe(400)
  })

  it('submits and approves the PO', async () => {
    const headers = await auth()
    const poId = poIds[0]

    const submitted = await call(`/api/purchase-orders/${poId}/submit`, apiJson(headers, {}))
    expect(submitted.status).toBe(200)
    expect(submitted.body.data.status).toBe('pending')

    const approved = await call(`/api/purchase-orders/${poId}/approve`, apiJson(headers, {}))
    expect(approved.status).toBe(200)
    expect(approved.body.data.status).toBe('approved')
    expect(approved.body.data.approvedAt).toBeTruthy()

    // Approving twice is a forbidden transition.
    const again = await call(`/api/purchase-orders/${poId}/approve`, apiJson(headers, {}))
    expect(again.status).toBe(409)
  })

  it('receives a partial goods receipt and moves stock into the warehouse', async () => {
    const headers = await auth()
    const poId = poIds[0]

    const res = await call(
      `/api/purchase-orders/${poId}/receive`,
      apiJson(headers, { warehouseId: warehouse.id, items: [{ purchaseOrderItemId: poItemId, quantity: 2 }] })
    )
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('partial')
    expect(res.body.data.receiptNumber.startsWith('#GR')).toBe(true)
    expect(res.body.data.receiptId).toBeTruthy()

    // Warehouse stock increased.
    const [whStock] = await db
      .select({ quantity: warehouseInventory.quantity })
      .from(warehouseInventory)
      .where(and(eq(warehouseInventory.warehouseId, warehouse.id), eq(warehouseInventory.variantId, variantId)))
    expect(whStock.quantity).toBe(2)

    // Global ledger + audit log (reason "purchase", reference = receipt number).
    const [variant] = await db
      .select({ inventory: productVariants.inventory })
      .from(productVariants)
      .where(eq(productVariants.id, variantId))
    expect(variant.inventory).toBe(variantBaseline + 2)

    const [log] = await db
      .select()
      .from(inventoryLogs)
      .where(and(eq(inventoryLogs.variantId, variantId), eq(inventoryLogs.reason, 'purchase')))
    expect(log.change).toBe(2)
    expect(log.reference).toBe(res.body.data.receiptNumber)

    const [receipt] = await db
      .select({ id: goodsReceipts.id })
      .from(goodsReceipts)
      .where(eq(goodsReceipts.receiptNumber, res.body.data.receiptNumber))
    const [rItem] = await db
      .select()
      .from(goodsReceiptItems)
      .where(eq(goodsReceiptItems.goodsReceiptId, receipt.id))
    expect(rItem.purchaseOrderItemId).toBe(poItemId)
    expect(rItem.quantity).toBe(2)
  })

  it('refuses over-receipt of an item', async () => {
    const headers = await auth()
    const poId = poIds[0]
    const res = await call(
      `/api/purchase-orders/${poId}/receive`,
      apiJson(headers, { warehouseId: warehouse.id, items: [{ purchaseOrderItemId: poItemId, quantity: 4 }] })
    )
    expect(res.status).toBe(400)
  })

  it('completes the PO when remaining quantity is received', async () => {
    const headers = await auth()
    const poId = poIds[0]
    const res = await call(
      `/api/purchase-orders/${poId}/receive`,
      apiJson(headers, { warehouseId: warehouse.id, items: [{ purchaseOrderItemId: poItemId, quantity: 3 }] })
    )
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('received')

    const detail = await call(`/api/purchase-orders/${poId}`, apiGet(headers))
    expect(detail.body.data.status).toBe('received')
    expect(detail.body.data.items[0].receivedQuantity).toBe(5)
    expect(detail.body.data.receipts.length).toBe(2)
  })

  it('cannot receive a non-approved PO', async () => {
    const headers = await auth()
    const res = await call(
      '/api/purchase-orders',
      apiJson(headers, { supplierId, items: [{ variantId, quantity: 1, unitCost: 1 }] })
    )
    const poId = res.body.data.id
    poIds.push(poId)
    // draft → receive should be rejected with 409 regardless of item payload
    const receive = await call(
      `/api/purchase-orders/${poId}/receive`,
      apiJson(headers, { warehouseId: warehouse.id, items: [{ purchaseOrderItemId: poItemId, quantity: 1 }] })
    )
    expect(receive.status).toBe(409)
  })

  it('cancels an approved PO that has never been received', async () => {
    const headers = await auth()
    const sup = (await call('/api/suppliers', apiJson(headers, { name: 'One-off Supplier' }))).body.data
    supplierIds.push(sup.id)
    const res = await call('/api/purchase-orders', apiJson(headers, { supplierId: sup.id, items: [{ variantId, quantity: 1, unitCost: 2 }] }))
    const poId = res.body.data.id
    poIds.push(poId)

    await call(`/api/purchase-orders/${poId}/submit`, apiJson(headers, {}))
    const approved = await call(`/api/purchase-orders/${poId}/approve`, apiJson(headers, {}))
    expect(approved.status).toBe(200)
    expect(approved.body.data.status).toBe('approved')

    const cancelled = await call(`/api/purchase-orders/${poId}/cancel`, apiJson(headers, {}))
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.data.status).toBe('cancelled')
  })

  it('cannot cancel a received PO', async () => {
    const headers = await auth()
    const poId = poIds[0]
    const res = await call(`/api/purchase-orders/${poId}/cancel`, apiJson(headers, {}))
    expect(res.status).toBe(409)
  })

  it('lists goods receipts with purchase order and warehouse context', async () => {
    const headers = await auth()
    const res = await call('/api/goods-receipts', apiGet(headers))
    expect(res.status).toBe(200)
    expect(res.body.data.items.length).toBeGreaterThanOrEqual(1)
    const first = res.body.data.items[0]
    expect(first.poNumber.startsWith('#PO')).toBe(true)
    expect(first.warehouseName).toBe('Proc Wh')
  })
})