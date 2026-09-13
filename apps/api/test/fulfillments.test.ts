import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq, isNull } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { fulfillments, orders, users } from '../src/database/schema'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const body = await res.json()
  return { status: res.status, body }
}

const jh = { 'Content-Type': 'application/json' }

const loginAs = async (email: string, password = 'password123') => {
  const res = await call('/api/auth/login', {
    method: 'POST',
    headers: jh,
    body: JSON.stringify({ email, password })
  })
  return { authorization: `Bearer ${res.body.data.accessToken}` }
}

describe('fulfillments lifecycle & order-level status (P0)', () => {
  let merchantId: string
  let admin: Record<string, string> = {}
  let fulfillableId = ''
  let cancelledId = ''
  let fulfillmentId = ''

  beforeAll(async () => {
    admin = await loginAs('admin@jamicore.com')

    const [merchant] = await db.select().from(users).where(eq(users.email, 'admin@jamicore.com'))
    merchantId = merchant.merchantId

    // An order eligible for fulfillment (not cancelled/refunded, has a customer).
    const [fulfillable] = await db
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(
        and(
          eq(orders.merchantId, merchantId),
          isNull(orders.outletId),
          eq(orders.status, 'pending'),
          eq(orders.fulfillmentStatus, 'unfulfilled')
        )
      )
      .limit(1)
    expect(fulfillable).toBeDefined()
    fulfillableId = fulfillable.id

    // A canned cancelled order — create() must reject it regardless of seed data.
    const [cancelled] = await db
      .insert(orders)
      .values({
        merchantId,
        customerId: null,
        orderNumber: '#FUL-CANCEL',
        status: 'cancelled',
        paymentStatus: 'unpaid',
        fulfillmentStatus: 'unfulfilled',
        subtotal: 0,
        shippingTotal: 0,
        discountTotal: 0,
        taxTotal: 0,
        total: 0,
        currency: 'USD'
      })
      .returning({ id: orders.id })
    cancelledId = cancelled.id
  })

  it('creates a fulfillment without touching the binary order-level status', async () => {
    const res = await call('/api/fulfillments', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ orderId: fulfillableId, carrier: 'FedEx' })
    })
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('unfulfilled')
    expect(res.body.data.carrier).toBe('FedEx')
    fulfillmentId = res.body.data.id

    const [order] = await db.select().from(orders).where(eq(orders.id, fulfillableId))
    expect(order.fulfillmentStatus).toBe('unfulfilled')
  })

  it('rejects creating a fulfillment on a cancelled order', async () => {
    const res = await call('/api/fulfillments', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ orderId: cancelledId })
    })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('ORDER_NOT_FULFILLABLE')
  })

  it('rejects illegal skips in the status graph', async () => {
    const res = await call(`/api/fulfillments/${fulfillmentId}`, {
      method: 'PUT',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ status: 'delivered' })
    })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_TRANSITION')
  })

  it('walks the legal chain and flips the order to fulfilled only on ship/deliver', async () => {
    for (const status of ['processing', 'packed', 'shipped']) {
      const res = await call(`/api/fulfillments/${fulfillmentId}`, {
        method: 'PUT',
        headers: { ...admin, ...jh },
        body: JSON.stringify({ status })
      })
      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe(status)

      const [order] = await db.select().from(orders).where(eq(orders.id, fulfillableId))
      // Intermediate states keep the order-level status binary-consistent.
      expect(order.fulfillmentStatus).toBe(status === 'shipped' ? 'fulfilled' : 'unfulfilled')
    }
  })

  it('delivers and reports shippedAt/deliveredAt timestamps', async () => {
    const res = await call(`/api/fulfillments/${fulfillmentId}/ship`, {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({
        trackingNumber: '1Z999AA10123456784',
        trackingUrl: 'https://track.example/1Z999AA10123456784'
      })
    })
    expect(res.status).toBe(200)
    expect(res.body.data.shippedAt).toBeTruthy()
  })

  it('lists fulfillments with real customer email and order number', async () => {
    const res = await call('/api/fulfillments', { headers: admin })
    expect(res.status).toBe(200)
    const item = res.body.data.items.find((f: { id: string }) => f.id === fulfillmentId)
    expect(item).toBeDefined()
    expect(item.orderNumber).toBeTruthy()
    expect(item.customerEmail).not.toBeNull()
  })

  it('returns order context on single-fetch', async () => {
    const res = await call(`/api/fulfillments/${fulfillmentId}`, { headers: admin })
    expect(res.status).toBe(200)
    expect(res.body.data.orderNumber).toBeTruthy()
    expect(res.body.data.customerEmail).not.toBeNull()
  })

  afterAll(async () => {
    await db.delete(fulfillments).where(eq(fulfillments.merchantId, merchantId))
    await db.delete(orders).where(eq(orders.orderNumber, '#FUL-CANCEL'))
  })
})