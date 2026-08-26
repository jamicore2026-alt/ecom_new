import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq, like } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { app } from '../src/app'
import { db } from '../src/database/client'
import {
  coupons,
  customers,
  merchants,
  orderItems,
  orders,
  productVariants,
  products,
  refunds,
  returnsTable
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

const patch = (body: unknown, token?: string) => ({
  method: 'PATCH',
  headers: {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {})
  },
  body: JSON.stringify(body)
})

const ADDRESS = {
  name: 'State Machine Tester',
  line1: '9 Test Way',
  city: 'Kuala Lumpur',
  state: 'KL',
  postalCode: '50000',
  country: 'MY'
}

describe('Order/checkout state machine hardening', () => {
  let adminToken = ''
  let fixtureProductId = ''
  let fixtureVariantId = ''
  let rivalMerchantId = ''
  let rivalProductId = ''
  const placedOrderNumbers: string[] = []

  const placeOrder = async (paymentMethod: 'cod' | 'card', couponCode?: string) => {
    const res = await call(
      '/api/store/acme-store/checkout',
      json({
        items: [{ productId: fixtureProductId, variantId: fixtureVariantId, quantity: 1 }],
        email: 'statemachine@example.com',
        shippingAddress: ADDRESS,
        paymentMethod,
        ...(couponCode ? { couponCode } : {})
      })
    )
    expect(res.status).toBe(200)
    placedOrderNumbers.push(res.body.data.orderNumber)
    return res.body.data
  }

  const orderIdFor = async (orderNumber: string) => {
    const [row] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.orderNumber, orderNumber))
    return row.id
  }

  beforeAll(async () => {
    const login = await call(
      '/api/auth/login',
      json({ email: 'admin@acme.com', password: 'password123' })
    )
    adminToken = login.body.data.accessToken

    // Fixture product owned by acme with tracked stock
    const created = await call(
      '/api/products',
      json(
        {
          sku: 'SMFIX-1',
          name: 'State Machine Fixture',
          price: 25,
          status: 'active',
          trackInventory: true,
          variants: [{ sku: 'SMFIX-1-D', optionValues: {}, inventory: 10 }]
        },
        adminToken
      )
    )
    expect(created.status).toBe(200)
    fixtureProductId = created.body.data.id
    fixtureVariantId = created.body.data.variants[0].id

    // Rival tenant: another merchant + an active product we must NOT be able to buy via acme.
    const [rival] = await db
      .insert(merchants)
      .values({
        name: 'Rival Store',
        slug: `rival-store-${createId().slice(0, 8)}`,
        email: `rival-${createId().slice(0, 8)}@test.local`,
        currency: 'USD',
        timezone: 'UTC',
        status: 'active'
      })
      .returning()
    rivalMerchantId = rival.id
    const [rivalProduct] = await db
      .insert(products)
      .values({
        merchantId: rivalMerchantId,
        name: 'Rival Item',
        slug: `rival-item-${createId().slice(0, 8)}`,
        sku: 'RIVAL-1',
        price: '99.00',
        status: 'active',
        trackInventory: true
      })
      .returning()
    rivalProductId = rivalProduct.id
    await db.insert(productVariants).values({
      productId: rivalProductId,
      optionValues: {},
      sku: 'RIVAL-1-D',
      price: '99.00',
      inventory: 50
    })
  })

  it('rejects a checkout mixing another merchant product into acme checkout', async () => {
    const preview = await call('/api/store/acme-store/checkout/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [
          { productId: fixtureProductId, variantId: fixtureVariantId, quantity: 1 },
          { productId: rivalProductId, variantId: 'nonexistent', quantity: 1 }
        ]
      })
    })
    expect(preview.status).toBe(400)
    expect(preview.body.error.code).toBe('PRODUCT_NOT_FOUND')

    const checkout = await call('/api/store/acme-store/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [{ productId: rivalProductId, variantId: 'nonexistent', quantity: 1 }],
        email: 'thief@example.com',
        shippingAddress: ADDRESS,
        paymentMethod: 'cod'
      })
    })
    expect(checkout.status).toBe(400)
    expect(checkout.body.error.code).toBe('PRODUCT_NOT_FOUND')

    // The rival's stock must be untouched.
    const [variant] = await db
      .select()
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(eq(products.merchantId, rivalMerchantId))
    expect(variant.product_variants.inventory).toBe(50)
  })

  it('cancels a pending unpaid order and restores its coupon quota', async () => {
    const [acmeCouponBefore] = await db.select().from(coupons).where(eq(coupons.code, 'WELCOME15'))
    const order = await placeOrder('cod', 'WELCOME15')
    expect(order.paymentStatus).toBe('unpaid')
    const id = await orderIdFor(order.orderNumber)

    const cancelRes = await call(`/api/orders/${id}/cancel`, json({}, adminToken))
    expect(cancelRes.status).toBe(200)
    expect(cancelRes.body.data.status).toBe('cancelled')
    expect(cancelRes.body.data.paymentStatus).toBe('failed')

    const [acmeCouponAfter] = await db.select().from(coupons).where(eq(coupons.code, 'WELCOME15'))
    expect(Number(acmeCouponAfter.usedCount)).toBe(Number(acmeCouponBefore.usedCount))

    const [variant] = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, fixtureVariantId))
    expect(variant.inventory).toBe(10) // fully restored by the cancellation
  })

  it('refuses to cancel a paid order — refunds are the only path', async () => {
    const order = await placeOrder('card') // legacy demo method places as paid
    expect(order.paymentStatus).toBe('paid')
    const id = await orderIdFor(order.orderNumber)

    const res = await call(`/api/orders/${id}/cancel`, json({}, adminToken))
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('REFUND_REQUIRED')

    const [stillThere] = await db
      .select({ status: orders.status, paymentStatus: orders.paymentStatus })
      .from(orders)
      .where(eq(orders.id, id))
    expect(stillThere.status).not.toBe('cancelled')
    expect(stillThere.paymentStatus).toBe('paid')
  })

  it('blocks delivered→refunded through the generic status endpoint', async () => {
    const order = await placeOrder('card')
    const id = await orderIdFor(order.orderNumber)

    for (const next of ['processing', 'shipped', 'delivered']) {
      const step = await call(`/api/orders/${id}/status`, patch({ status: next }, adminToken))
      expect(step.status).toBe(200)
    }
    const refundAttempt = await call(
      `/api/orders/${id}/status`,
      patch({ status: 'refunded' }, adminToken)
    )
    expect(refundAttempt.status).toBe(400)
    expect(refundAttempt.body.error.code).toBe('INVALID_TRANSITION')

    const payRefundAttempt = await call(
      `/api/orders/${id}/status`,
      patch({ paymentStatus: 'refunded' }, adminToken)
    )
    expect(payRefundAttempt.status).toBe(400)
    expect(payRefundAttempt.body.error.code).toBe('INVALID_TRANSITION')
  })

  it('completes a real refund and refuses over-refunding', async () => {
    const order = await placeOrder('card')
    const id = await orderIdFor(order.orderNumber)

    const first = await call(
      '/api/refunds',
      json({ orderId: id, amount: order.total, method: 'original' }, adminToken)
    )
    expect(first.status).toBe(200)
    expect(first.body.data.status).toBe('completed')

    const second = await call(
      '/api/refunds',
      json({ orderId: id, amount: 5, method: 'original' }, adminToken)
    )
    expect(second.status).toBe(400)

    const [after] = await db
      .select({ paymentStatus: orders.paymentStatus, status: orders.status })
      .from(orders)
      .where(eq(orders.id, id))
    expect(after.paymentStatus).toBe('refunded')

    const rows = await db.select().from(refunds).where(eq(refunds.orderId, id))
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('completed')
  })

  it('double-approving a return restocks exactly once', async () => {
    const order = await placeOrder('cod')
    const id = await orderIdFor(order.orderNumber)
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, id))

    const created = await call(
      '/api/returns',
      json({ orderId: id, orderItemId: item.id, quantity: 1, reason: 'test' }, adminToken)
    )
    expect(created.status).toBe(200)
    const returnId = created.body.data.id

    const invBefore = (
      await db.select().from(productVariants).where(eq(productVariants.id, fixtureVariantId))
    )[0].inventory

    const first = await call(`/api/returns/${returnId}`, patch({ status: 'approved' }, adminToken))
    expect(first.status).toBe(200)

    const second = await call(`/api/returns/${returnId}`, patch({ status: 'approved' }, adminToken))
    expect(second.status).toBe(400)
    expect(second.body.error.code).toBe('RETURN_ALREADY_PROCESSED')

    const invAfter = (
      await db.select().from(productVariants).where(eq(productVariants.id, fixtureVariantId))
    )[0].inventory
    expect(invAfter).toBe(invBefore + 1) // one restock only
  })

  it('refuses to approve a return on a cancelled order', async () => {
    const order = await placeOrder('cod')
    const id = await orderIdFor(order.orderNumber)
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, id))

    const created = await call(
      '/api/returns',
      json({ orderId: id, orderItemId: item.id, quantity: 1, reason: 'late request' }, adminToken)
    )
    const returnId = created.body.data.id

    // Cancel while the return is still pending (order is unpaid COD).
    const cancelRes = await call(`/api/orders/${id}/cancel`, json({}, adminToken))
    expect(cancelRes.status).toBe(200)

    const invAfterCancel = (
      await db.select().from(productVariants).where(eq(productVariants.id, fixtureVariantId))
    )[0].inventory

    const approve = await call(`/api/returns/${returnId}`, patch({ status: 'approved' }, adminToken))
    expect(approve.status).toBe(400)
    expect(approve.body.error.code).toBe('ORDER_CANCELLED')

    const invFinal = (
      await db.select().from(productVariants).where(eq(productVariants.id, fixtureVariantId))
    )[0].inventory
    expect(invFinal).toBe(invAfterCancel) // no second restock of dead stock
  })

  afterAll(async () => {
    // Remove the fixture product and everything hanging off the test orders.
    if (fixtureProductId) await db.delete(products).where(eq(products.id, fixtureProductId))

    const [merchant] = await db.select().from(merchants).where(eq(merchants.slug, 'acme-store'))
    if (merchant) {
      const testOrders = await db
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.merchantId, merchant.id), like(orders.orderNumber, '#W%')))
      for (const o of testOrders) {
        await db.delete(refunds).where(eq(refunds.orderId, o.id))
        await db.delete(returnsTable).where(eq(returnsTable.orderId, o.id))
      }
      await db
        .delete(orders)
        .where(and(eq(orders.merchantId, merchant.id), like(orders.orderNumber, '#W%')))
      await db
        .delete(customers)
        .where(and(eq(customers.merchantId, merchant.id), eq(customers.email, 'statemachine@example.com')))
    }

    if (rivalMerchantId) {
      await db.delete(products).where(eq(products.merchantId, rivalMerchantId))
      await db.delete(merchants).where(eq(merchants.id, rivalMerchantId))
    }
  })
})
