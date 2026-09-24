import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import {
  fulfillmentItems,
  fulfillments,
  orderItems,
  orders,
  productVariants,
  products,
  refunds
} from '../src/database/schema'

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

const ADDRESS = {
  name: 'Split Tester',
  line1: '7 Split Way',
  line2: 'Apt 2',
  city: 'Kuwait City',
  state: 'KW',
  postalCode: '10000',
  country: 'KW',
  phone: '+965 5550101'
}

describe('split fulfillments + cancel-with-refund', () => {
  let adminToken = ''
  let fixtureProductId = ''
  let fixtureVariantId = ''
  const orderIds: string[] = []

  const placeOrder = async (paymentMethod: 'cod' | 'card', quantity: number) => {
    const res = await call(
      '/api/store/jamicore-store/checkout',
      json({
        items: [{ productId: fixtureProductId, variantId: fixtureVariantId, quantity }],
        email: 'splitfulfill@example.com',
        shippingAddress: ADDRESS,
        paymentMethod
      })
    )
    expect(res.status).toBe(200)
    const [row] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.orderNumber, res.body.data.orderNumber))
    orderIds.push(row.id)
    return row.id
  }

  const auth = () => adminToken

  beforeAll(async () => {
    const login = await call(
      '/api/auth/login',
      json({ email: 'admin@jamicore.com', password: 'password123' })
    )
    adminToken = login.body.data.accessToken

    const created = await call(
      '/api/products',
      json(
        {
          sku: 'SPLITFIX-1',
          name: 'Split Fixture',
          price: 25,
          status: 'active',
          trackInventory: true,
          variants: [{ sku: 'SPLITFIX-1-D', optionValues: {}, inventory: 20 }]
        },
        adminToken
      )
    )
    expect(created.status).toBe(200)
    fixtureProductId = created.body.data.id
    fixtureVariantId = created.body.data.variants[0].id
  })

  it('stores split lines and returns them on get', async () => {
    const orderId = await placeOrder('cod', 3)
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId))
    expect(items).toHaveLength(1)

    const res = await call(
      '/api/fulfillments',
      json({ orderId, items: [{ orderItemId: items[0].id, quantity: 2 }] }, auth())
    )
    expect(res.status).toBe(200)
    expect(res.body.data.lines).toHaveLength(1)
    expect(res.body.data.lines[0].orderItemId).toBe(items[0].id)
    expect(res.body.data.lines[0].quantity).toBe(2)
    const fulfillmentId = res.body.data.id

    const stored = await db
      .select()
      .from(fulfillmentItems)
      .where(eq(fulfillmentItems.fulfillmentId, fulfillmentId))
    expect(stored).toHaveLength(1)
    expect(stored[0].quantity).toBe(2)

    const fetched = await call(`/api/fulfillments/${fulfillmentId}`, {
      headers: { authorization: `Bearer ${auth()}` }
    })
    expect(fetched.status).toBe(200)
    expect(fetched.body.data.lines).toHaveLength(1)
    expect(fetched.body.data.lines[0].quantity).toBe(2)
  })

  it('rejects over-fulfillment and foreign items, keeps legacy whole-order', async () => {
    const orderId = await placeOrder('cod', 3)
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId))

    const first = await call(
      '/api/fulfillments',
      json({ orderId, items: [{ orderItemId: items[0].id, quantity: 2 }] }, auth())
    )
    expect(first.status).toBe(200)

    // Cumulative 2 + 2 > ordered 3.
    const over = await call(
      '/api/fulfillments',
      json({ orderId, items: [{ orderItemId: items[0].id, quantity: 2 }] }, auth())
    )
    expect(over.status).toBe(400)
    expect(over.body.error.code).toBe('OVER_FULFILLED')

    // Exact remainder still fits.
    const exact = await call(
      '/api/fulfillments',
      json({ orderId, items: [{ orderItemId: items[0].id, quantity: 1 }] }, auth())
    )
    expect(exact.status).toBe(200)

    const foreign = await call(
      '/api/fulfillments',
      json({ orderId, items: [{ orderItemId: 'nonexistent-item', quantity: 1 }] }, auth())
    )
    expect(foreign.status).toBe(400)
    expect(foreign.body.error.code).toBe('ORDER_ITEM_MISMATCH')

    // Legacy: no items = whole order, no lines stored.
    const legacy = await call('/api/fulfillments', json({ orderId }, auth()))
    expect(legacy.status).toBe(200)
    expect(legacy.body.data.lines).toHaveLength(0)
  })

  it('cancel-with-refund produces a cancelled order + refund row + restock', async () => {
    const orderId = await placeOrder('card', 2)
    const [before] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
    expect(before.paymentStatus).toBe('paid')

    const invBefore = (
      await db.select().from(productVariants).where(eq(productVariants.id, fixtureVariantId))
    )[0].inventory

    const res = await call(`/api/orders/${orderId}/cancel`, json({ refund: true }, auth()))
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('cancelled')

    const [after] = await db.select().from(orders).where(eq(orders.id, orderId))
    expect(after.status).toBe('cancelled')
    expect(after.paymentStatus).toBe('refunded')

    const rows = await db.select().from(refunds).where(eq(refunds.orderId, orderId))
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('completed')
    expect(Number(rows[0].amount)).toBeCloseTo(Number(before.total), 2)

    const invAfter = (
      await db.select().from(productVariants).where(eq(productVariants.id, fixtureVariantId))
    )[0].inventory
    expect(invAfter).toBe(invBefore + 2)
  })

  it('plain cancel on a paid order still requires the refunds flow', async () => {
    const orderId = await placeOrder('card', 1)
    const res = await call(`/api/orders/${orderId}/cancel`, json({}, auth()))
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('REFUND_REQUIRED')
  })

  afterAll(async () => {
    for (const id of orderIds) {
      await db.delete(fulfillments).where(eq(fulfillments.orderId, id))
      await db.delete(refunds).where(eq(refunds.orderId, id))
      await db.delete(orders).where(eq(orders.id, id))
    }
    if (fixtureProductId) await db.delete(products).where(eq(products.id, fixtureProductId))
  })
})
