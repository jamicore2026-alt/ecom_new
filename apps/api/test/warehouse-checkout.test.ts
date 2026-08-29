import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq, inArray, like } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import {
  customers,
  inventoryLogs,
  merchants,
  orders,
  productVariants,
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

const checkoutPayload = (email: string, extra: Record<string, unknown> = {}) => ({
  items: [{ productId: product.id, variantId, quantity: 1 }],
  email,
  shippingAddress: {
    name: 'Wh Buyer',
    line1: '1 Main St',
    city: 'New York',
    state: 'NY',
    postalCode: '10001',
    country: 'US'
  },
  paymentMethod: 'card',
  ...extra
})

let product: any
let variantId: string
let merchantId: string
let globalBefore = 0
let defaultWh: any
let otherWh: any
const createdOrderNumbers: string[] = []
const createdCustomerEmails: string[] = []

describe('Multi-warehouse checkout allocation', () => {
  beforeAll(async () => {
    const [merchant] = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.slug, 'acme-store'))
    merchantId = merchant.id

    const list = await call('/api/store/acme-store/products?limit=100')
    product = list.body.data.items.find((i: any) => i.stock >= 20)
    const detail = await call(`/api/store/acme-store/products/${product.slug}`)
    variantId = detail.body.data.variants[0].id

    const [variant] = await db.select({ inventory: productVariants.inventory }).from(productVariants).where(eq(productVariants.id, variantId))
    globalBefore = variant.inventory

    // One default warehouse + one secondary, both stocked with the variant.
    const headers = await auth()
    defaultWh = (await call('/api/warehouses', apiJson(headers, { name: 'Wh Default', code: 'WHDEF', isDefault: true }))).body.data
    otherWh = (await call('/api/warehouses', apiJson(headers, { name: 'Wh Other', code: 'WHOTH', isDefault: false }))).body.data

    await call(`/api/warehouses/${defaultWh.id}/inventory`, apiPut(headers, { variantId, quantity: 100 }))
    await call(`/api/warehouses/${otherWh.id}/inventory`, apiPut(headers, { variantId, quantity: 100 }))
  })

  it('records the default warehouse on the order and decrements its stock when none is specified', async () => {
    const res = await call('/api/store/acme-store/checkout', json(checkoutPayload('wh-default@example.com')))
    expect(res.status).toBe(200)
    createdOrderNumbers.push(res.body.data.orderNumber)
    createdCustomerEmails.push('wh-default@example.com')

    const [order] = await db.select({ warehouseId: orders.warehouseId, orderNumber: orders.orderNumber }).from(orders).where(eq(orders.orderNumber, res.body.data.orderNumber))
    expect(order.warehouseId).toBe(defaultWh.id)

    const [stock] = await db.select({ quantity: warehouseInventory.quantity }).from(warehouseInventory).where(and(eq(warehouseInventory.warehouseId, defaultWh.id), eq(warehouseInventory.variantId, variantId)))
    expect(stock.quantity).toBe(99)
  })

  it('uses the explicit fulfillment warehouse when provided, leaving the default untouched', async () => {
    const res = await call('/api/store/acme-store/checkout', json(checkoutPayload('wh-other@example.com', { fulfillmentWarehouseId: otherWh.id })))
    expect(res.status).toBe(200)
    createdOrderNumbers.push(res.body.data.orderNumber)
    createdCustomerEmails.push('wh-other@example.com')

    const [order] = await db.select({ warehouseId: orders.warehouseId }).from(orders).where(eq(orders.orderNumber, res.body.data.orderNumber))
    expect(order.warehouseId).toBe(otherWh.id)

    const [otherStock] = await db.select({ quantity: warehouseInventory.quantity }).from(warehouseInventory).where(and(eq(warehouseInventory.warehouseId, otherWh.id), eq(warehouseInventory.variantId, variantId)))
    expect(otherStock.quantity).toBe(99)

    const [defaultStock] = await db.select({ quantity: warehouseInventory.quantity }).from(warehouseInventory).where(and(eq(warehouseInventory.warehouseId, defaultWh.id), eq(warehouseInventory.variantId, variantId)))
    expect(defaultStock.quantity).toBe(99)
  })

  it('still succeeds when a variant is not stocked in the warehouse (legacy global inventory path)', async () => {
    const emptyWh = (await call('/api/warehouses', apiJson(await auth(), { name: 'Wh Empty', code: 'WHEMT', isDefault: false }))).body.data
    const res = await call('/api/store/acme-store/checkout', json(checkoutPayload('wh-empty@example.com', { fulfillmentWarehouseId: emptyWh.id })))
    expect(res.status).toBe(200)
    createdOrderNumbers.push(res.body.data.orderNumber)
    createdCustomerEmails.push('wh-empty@example.com')

    const [order] = await db.select({ warehouseId: orders.warehouseId }).from(orders).where(eq(orders.orderNumber, res.body.data.orderNumber))
    expect(order.warehouseId).toBe(emptyWh.id)

    await db.delete(warehouses).where(eq(warehouses.id, emptyWh.id))
  })

  afterAll(async () => {
    // Restore global inventory that this suite consumed so other suites keep clean thresholds.
    const consumed = createdOrderNumbers.length
    await db
      .update(productVariants)
      .set({ inventory: globalBefore - consumed })
      .where(eq(productVariants.id, variantId))

    await db.delete(warehouseInventory).where(and(eq(warehouseInventory.merchantId, merchantId), eq(warehouseInventory.variantId, variantId)))
    await db.delete(warehouses).where(and(eq(warehouses.merchantId, merchantId), inArray(warehouses.id, [defaultWh.id, otherWh.id])))
    await db.delete(customers).where(and(eq(customers.merchantId, merchantId), inArray(customers.email, createdCustomerEmails)))
    await db.delete(inventoryLogs).where(and(eq(inventoryLogs.merchantId, merchantId), like(inventoryLogs.reference, '#W%')))
    await db.delete(orders).where(and(eq(orders.merchantId, merchantId), like(orders.orderNumber, '#W%')))
  })
})
