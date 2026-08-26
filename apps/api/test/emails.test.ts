import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import {
  customers,
  emailLogs,
  inventoryLogs,
  merchants,
  orderItems,
  orders,
  productVariants
} from '../src/database/schema'
import type { EmailTemplateId } from '../src/database/schema'
import { EmailsService } from '../src/modules/emails/service'
import { OrdersService } from '../src/modules/orders/service'
import { setMailer } from '../src/shared/mailer'

process.env.RESEND_API_KEY = ''
setMailer(null)

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

/** Fire-and-forget delivery needs a moment to land in the log table. */
/** Delivery is fire-and-forget: poll until the log reaches a terminal state. */
async function waitForLog(orderId: string, template: EmailTemplateId, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const [row] = await db
      .select()
      .from(emailLogs)
      .where(and(eq(emailLogs.orderId, orderId), eq(emailLogs.template, template)))
    if (row && row.status !== 'queued') return row
    await new Promise((r) => setTimeout(r, 50))
  }
  return null
}

describe('transactional emails', () => {
  let merchantId = ''
  let productId = ''
  let variantId = ''
  let adminAuth: Record<string, string> = {}
  const createdOrderIds: string[] = []

  beforeAll(async () => {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.slug, 'acme-store'))
    merchantId = merchant.id

    const list = await call('/api/store/acme-store/products?limit=100')
    const items = list.body.data.items as Array<{ id: string; slug: string; stock: number }>
    const product = items.reduce((a, b) => (b.stock > a.stock ? b : a))
    productId = product.id
    const detail = await call(`/api/store/acme-store/products/${product.slug}`)
    variantId = detail.body.data.variants[0].id

    const login = await call('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@acme.com', password: 'password123' })
    })
    adminAuth = { authorization: `Bearer ${login.body.data.accessToken}` }
  })

  afterAll(async () => {
    // Restore inventory the same way the expired-order sweeper does, then clean up.
    for (const orderId of createdOrderIds) {
      const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId))
      for (const item of items) {
        if (!item.variantId) continue
        const [variant] = await db
          .select()
          .from(productVariants)
          .where(eq(productVariants.id, item.variantId))
        if (!variant) continue
        const afterValue = variant.inventory + item.quantity
        await db
          .update(productVariants)
          .set({ inventory: afterValue })
          .where(eq(productVariants.id, variant.id))
        await db.insert(inventoryLogs).values({
          merchantId,
          variantId: variant.id,
          change: item.quantity,
          beforeValue: variant.inventory,
          afterValue,
          reason: 'cancel'
        })
      }
    }
    if (createdOrderIds.length) {
      await db.delete(orders).where(inArray(orders.id, createdOrderIds))
    }
    // Checkouts upsert a customer per email — remove the ones this file created.
    const testEmails = ['mail-order@example.com', 'mail-cod@example.com', 'mail-refund@example.com', 'mail-optout@example.com']
    await db.delete(customers).where(and(eq(customers.merchantId, merchantId), inArray(customers.email, testEmails)))
  })

  const placeCardOrder = async (email: string) => {
    const res = await call(
      '/api/store/acme-store/checkout',
      json({
        items: [{ productId, variantId, quantity: 1 }],
        email,
        shippingAddress: {
          name: 'Mail Test',
          line1: '5 Test Ln',
          city: 'Kuwait City',
          state: 'KW',
          postalCode: '10000',
          country: 'KW'
        },
        paymentMethod: 'card'
      })
    )
    expect(res.status).toBe(200)
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.orderNumber, res.body.data.orderNumber))
    createdOrderIds.push(order.id)
    return order
  }

  it('sends an order confirmation when an order is placed', async () => {
    const order = await placeCardOrder('mail-order@example.com')
    expect(order.paymentStatus).toBe('paid')

    const log = await waitForLog(order.id, 'order_placed')
    expect(log).not.toBeNull()
    expect(log!.status).toBe('sent')
    expect(log!.toEmail).toBe('mail-order@example.com')
    expect(log!.subject).toContain(order.orderNumber)
  })

  it('sends a payment-received email on the unpaid → paid transition', async () => {
    const codRes = await call(
      '/api/store/acme-store/checkout',
      json({
        items: [{ productId, variantId, quantity: 1 }],
        email: 'mail-cod@example.com',
        shippingAddress: {
          name: 'COD Mail',
          line1: '6 Test Ln',
          city: 'Kuwait City',
          state: 'KW',
          postalCode: '10000',
          country: 'KW'
        },
        paymentMethod: 'cod'
      })
    )
    expect(codRes.status).toBe(200)
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.orderNumber, codRes.body.data.orderNumber))
    createdOrderIds.push(order.id)
    expect(order.paymentStatus).toBe('unpaid')

    await EmailsService.orderPaid(order.merchantId, order.id)
    const log = await waitForLog(order.id, 'order_paid')
    expect(log).not.toBeNull()
    expect(log!.status).toBe('sent')
    expect(log!.toEmail).toBe('mail-cod@example.com')
  })

  it('emails the customer after a refund is processed', async () => {
    const order = await placeCardOrder('mail-refund@example.com')

    await OrdersService.createRefund(order.merchantId, {
      orderId: order.id,
      amount: Number(order.total)
    })

    const log = await waitForLog(order.id, 'refund_processed')
    expect(log).not.toBeNull()
    expect(log!.status).toBe('sent')
    expect(log!.toEmail).toBe('mail-refund@example.com')
  })

  it('respects per-template opt-outs', async () => {
    await app.handle(
      new Request('http://localhost/api/settings/notifications', {
        method: 'PUT',
        headers: { ...adminAuth, 'content-type': 'application/json' },
        body: JSON.stringify({ templates: { order_placed: false } })
      })
    )

    const order = await placeCardOrder('mail-optout@example.com')
    await new Promise((r) => setTimeout(r, 300))
    const log = await waitForLog(order.id, 'order_placed', 500)
    expect(log).toBeNull()

    // restore
    await app.handle(
      new Request('http://localhost/api/settings/notifications', {
        method: 'PUT',
        headers: { ...adminAuth, 'content-type': 'application/json' },
        body: JSON.stringify({ templates: { order_placed: true } })
      })
    )
  })
})
