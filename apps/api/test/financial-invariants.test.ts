import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq, inArray, like } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import {
  customers,
  inventoryLogs,
  merchants,
  orders,
  paymentTransactions,
  refunds
} from '../src/database/schema'
import { OrdersService } from '../src/modules/orders/service'

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

const jsonHeaders = { 'Content-Type': 'application/json' }

/** Authenticated header set for dashboard APIs (POS/food-order flows). */
async function adminHeaders(): Promise<Record<string, string>> {
  const res = await call('/api/auth/login', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email: 'admin@acme.com', password: 'password123' })
  })
  return { authorization: `Bearer ${res.body.data.accessToken}` }
}

const cardCheckout = (email: string, idempotencyKey?: string, quantity = 1) =>
  json({
    items: [{ productId: product!.id, variantId: variantId!, quantity }],
    email,
    shippingAddress: {
      name: 'Invariant Buyer',
      line1: '1 Main St',
      city: 'New York',
      state: 'NY',
      postalCode: '10001',
      country: 'US'
    },
    paymentMethod: 'card',
    ...(idempotencyKey ? { idempotencyKey } : {})
  })

let product: any
let variantId: string
let merchantId: string
let merchantCurrency: string

describe('P1 financial invariants', () => {
  beforeAll(async () => {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.slug, 'acme-store'))
    merchantId = merchant.id
    merchantCurrency = merchant.currency

    const list = await call('/api/store/acme-store/products?limit=100')
    product = list.body.data.items.find((i: any) => i.stock >= 20)
    const detail = await call(`/api/store/acme-store/products/${product.slug}`)
    variantId = detail.body.data.variants[0].id
  })

  it('records a payment transaction + customer spend for a card checkout', async () => {
    const res = await call('/api/store/acme-store/checkout', cardCheckout('spend@example.com'))
    expect(res.status).toBe(200)
    const order = res.body.data
    expect(order.paymentStatus).toBe('paid')
    expect(order.idempotencyKey).toBeUndefined()

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(row.paymentStatus).toBe('paid')
    expect(row.paymentProvider).toBeNull()
    expect(row.currency).toBe(merchantCurrency)

    const txns = await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.orderId, row.id))
    expect(txns).toHaveLength(1)
    expect(txns[0].provider).toBe('card')
    expect(txns[0].status).toBe('paid')
    expect(Number(txns[0].amount)).toBeCloseTo(Number(row.total))
    expect(txns[0].currency).toBe(merchantCurrency)

    const [customer] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.merchantId, merchantId), eq(customers.email, 'spend@example.com')))
    expect(customer.totalSpent).toBeCloseTo(Number(row.total))
  })

  it('replays the same idempotency key without creating a duplicate order', async () => {
    const key = crypto.randomUUID()
    const payload = cardCheckout('replay@example.com', key, 2)

    const first = await call('/api/store/acme-store/checkout', payload)
    expect(first.status).toBe(200)
    const second = await call('/api/store/acme-store/checkout', payload)
    expect(second.status).toBe(200)
    expect(second.body.data.id).toBe(first.body.data.id)

    const matches = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.merchantId, merchantId), eq(orders.idempotencyKey, key)))
    expect(matches).toHaveLength(1)

    const txns = await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.orderId, first.body.data.id))
    expect(txns).toHaveLength(1)
  })

  it('returns the original refund on a completed idempotent replay', async () => {
    const placed = await call('/api/store/acme-store/checkout', cardCheckout('refund@example.com'))
    expect(placed.status).toBe(200)
    const orderId = placed.body.data.id

    const key = crypto.randomUUID()
    const first = await OrdersService.createRefund(merchantId, { orderId, amount: 10, idempotencyKey: key })
    expect(first.data.status).toBe('completed')

    const second = await OrdersService.createRefund(merchantId, { orderId, amount: 10, idempotencyKey: key })
    expect(second.data.id).toBe(first.data.id)
    expect(second.data.status).toBe('completed')

    const rows = await db
      .select()
      .from(refunds)
      .where(and(eq(refunds.orderId, orderId), eq(refunds.idempotencyKey, key)))
    expect(rows).toHaveLength(1)
    expect(rows[0].attemptCount).toBe(1)

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId))
    expect(order.paymentStatus).toBe('partially_refunded')
  })

  it('reuses the failed refund row when retried with the same key', async () => {
    const placed = await call('/api/store/acme-store/checkout', cardCheckout('retry@example.com'))
    const orderId = placed.body.data.id

    const key = crypto.randomUUID()
    const [failedRow] = await db
      .insert(refunds)
      .values({
        merchantId,
        orderId,
        amount: 5,
        method: 'original',
        providerRef: null,
        status: 'failed',
        lastError: 'gateway timeout',
        idempotencyKey: key,
        attemptCount: 1
      })
      .returning()

    const retried = await OrdersService.createRefund(merchantId, { orderId, amount: 5, idempotencyKey: key })
    expect(retried.data.id).toBe(failedRow.id)
    expect(retried.data.status).toBe('completed')
    expect(retried.data.attemptCount).toBe(2)

    const rows = await db
      .select()
      .from(refunds)
      .where(and(eq(refunds.orderId, orderId), eq(refunds.idempotencyKey, key)))
    expect(rows).toHaveLength(1)
    expect(rows[0].attemptCount).toBe(2)
  })

  it('captures POS cash payments into a payment transaction with change', async () => {
    const admin = await adminHeaders()
    const [merchant] = await db.select().from(merchants).where(eq(merchants.slug, 'acme-store'))

    const outlets = await call('/api/outlets', { headers: admin })
    const outletId = outlets.body.data.find((o: { code: string }) => o.code === 'MAIN').id
    const menu = await call('/api/menu', { headers: admin })
    const menuItem = menu.body.data.items.find((i: { available: boolean; status: string }) => i.available && i.status === 'active')

    const orderRes = await call('/api/food-orders', {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({
        orderType: 'POS',
        outletId,
        items: [{ menuItemId: menuItem.id, quantity: 1 }]
      })
    })
    expect(orderRes.status).toBe(200)
    const orderId = orderRes.body.data.id
    const total = Number(orderRes.body.data.total)
    expect(orderRes.body.data.status).toBe('CREATED')
    expect(orderRes.body.data.paymentStatus).toBe('unpaid')

    const cashReceived = Math.round((total + 20.02) * 100) / 100
    const paid = await call(`/api/food-orders/${orderId}/pay`, {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ paymentMethod: 'cash', cashReceived })
    })
    expect(paid.status).toBe(200)
    expect(paid.body.data.paymentStatus).toBe('paid')

    const txns = await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.orderId, orderId))
    expect(txns).toHaveLength(1)
    expect(txns[0].provider).toBe('cash')
    expect(txns[0].status).toBe('paid')
    expect(Number(txns[0].amount)).toBeCloseTo(total)
    expect(txns[0].currency).toBe(merchant.currency)
    expect(txns[0].raw).toEqual({ cashReceived, change: Math.round((cashReceived - total) * 100) / 100 })
  })

  it('rejects POS under-tender cash and cash tender on card payments', async () => {
    const admin = await adminHeaders()

    const outlets = await call('/api/outlets', { headers: admin })
    const outletId = outlets.body.data.find((o: { code: string }) => o.code === 'MAIN').id
    const menu = await call('/api/menu', { headers: admin })
    const menuItem = menu.body.data.items.find((i: { available: boolean; status: string }) => i.available && i.status === 'active')

    const orderRes = await call('/api/food-orders', {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({
        orderType: 'POS',
        outletId,
        items: [{ menuItemId: menuItem.id, quantity: 1 }]
      })
    })
    const orderId = orderRes.body.data.id
    const total = Number(orderRes.body.data.total)

    const under = await call(`/api/food-orders/${orderId}/pay`, {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ paymentMethod: 'cash', cashReceived: Math.max(0, total - 1) })
    })
    expect(under.status).toBe(400)
    expect(under.body.error.message).toContain('less than the total')

    const cashOnCard = await call(`/api/food-orders/${orderId}/pay`, {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ paymentMethod: 'card', cashReceived: 100 })
    })
    expect(cashOnCard.status).toBe(400)
    expect(cashOnCard.body.error.message).toContain('Cash tender only applies')

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId))
    expect(order.paymentStatus).toBe('unpaid')
  })

  afterAll(async () => {
    await db
      .delete(inventoryLogs)
      .where(and(eq(inventoryLogs.merchantId, merchantId), like(inventoryLogs.reference, '#W%')))
    // refunds + payment_transactions cascade with their orders
    await db.delete(orders).where(and(eq(orders.merchantId, merchantId), like(orders.orderNumber, '#W%')))
    await db.delete(orders).where(and(eq(orders.merchantId, merchantId), like(orders.orderNumber, '#F%')))
    await db
      .delete(customers)
      .where(
        and(
          eq(customers.merchantId, merchantId),
          inArray(customers.email, [
            'spend@example.com',
            'replay@example.com',
            'refund@example.com',
            'retry@example.com'
          ])
        )
      )
  })
})