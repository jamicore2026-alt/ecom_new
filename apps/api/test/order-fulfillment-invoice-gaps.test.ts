import { describe, expect, it } from 'bun:test'
import { and, eq, like } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import {
  customers,
  fulfillments,
  inventoryLogs,
  orderItems,
  orders,
  productVariants,
  users
} from '../src/database/schema'
import {
  computeShippingRate,
  validateRequiredFields
} from '../src/modules/storefront/shipping'
import { DEFAULT_CHECKOUT_REQUIRED_FIELDS } from '../src/shared/types'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const contentType = res.headers.get('content-type') ?? ''
  const body = contentType.includes('json') ? await res.json() : await res.arrayBuffer()
  return { status: res.status, headers: res.headers, body }
}

const json = (body: unknown, token?: string) => ({
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {})
  },
  body: JSON.stringify(body)
})

const get = (path: string, token?: string): RequestInit => ({
  headers: token ? { authorization: `Bearer ${token}` } : {}
})

const jh = { 'content-type': 'application/json' }

const loginAs = async (email: string, password = 'password123') => {
  const res = await call('/api/auth/login', {
    method: 'POST',
    headers: jh,
    body: JSON.stringify({ email, password })
  })
  return { authorization: `Bearer ${res.body.data.accessToken}` }
}

const stamp = Date.now()

describe('shipping weight tiers + ETA (pure)', () => {
  it('matches a weight-tiered rule only inside its bounds', () => {
    const ctx = {
      zones: [],
      freeAt: 0,
      rules: [
        { id: 'light', name: 'Light', type: 'default' as const, rate: 2, enabled: true, weightMax: 1 },
        { id: 'heavy', name: 'Heavy', type: 'default' as const, rate: 9, enabled: true, weightMin: 1.001 }
      ]
    }
    expect(computeShippingRate(ctx, 10, {}, 0.5)).toEqual({ method: 'Light', rate: 2 })
    expect(computeShippingRate(ctx, 10, {}, 5)).toEqual({ method: 'Heavy', rate: 9 })
  })

  it('returns etaDays from the matched rule', () => {
    const ctx = {
      zones: [],
      freeAt: 0,
      rules: [
        { id: '1', name: 'Express', type: 'default' as const, rate: 9, enabled: true, etaDays: 2 }
      ]
    }
    expect(computeShippingRate(ctx, 10, {}, 0)).toEqual({ method: 'Express', rate: 9, etaDays: 2 })
  })

  it('omits etaDays when the rule has none (backward compatible)', () => {
    const ctx = {
      zones: [],
      freeAt: 0,
      rules: [{ id: '1', name: 'Std', type: 'default' as const, rate: 4, enabled: true }]
    }
    expect(computeShippingRate(ctx, 10, {})).toEqual({ method: 'Std', rate: 4 })
  })

  it('keeps line2 optional by default', () => {
    expect(DEFAULT_CHECKOUT_REQUIRED_FIELDS.line2).toBe(false)
    expect(() =>
      validateRequiredFields(undefined, {
        name: 'A',
        phone: '+965',
        line1: 'St',
        city: 'C',
        state: 'S',
        postalCode: '123',
        country: 'KW'
      })
    ).not.toThrow()
  })
})

describe('orders/fulfillment/invoice gaps (API)', () => {
  let admin: Record<string, string> = {}
  let merchantId = ''
  let product: any
  let variantId: string | undefined
  let replacementVariantId = ''
  const NY = { name: 'T', line1: '1 Main St', city: 'New York', state: 'NY', postalCode: '10001', country: 'US', phone: '+15550100' }

  const guestCheckout = (email: string, paymentMethod = 'cod') =>
    call(
      '/api/store/jamicore-store/checkout',
      json({
        items: [{ productId: product.id, variantId, quantity: 1 }],
        email,
        shippingAddress: NY,
        paymentMethod
      })
    )

  it('boots fixtures', async () => {
    admin = await loginAs('admin@jamicore.com')
    const [merchant] = await db.select().from(users).where(eq(users.email, 'admin@jamicore.com'))
    merchantId = merchant.merchantId

    const list = await call('/api/store/jamicore-store/products?limit=100')
    product = list.body.data.items.find((i: any) => i.stock >= 20)
    expect(product).toBeDefined()
    const detail = await call(`/api/store/jamicore-store/products/${product.slug}`)
    // Variants split stock — pick one that can actually cover the test qty.
    variantId = detail.body.data.variants.find((v: any) => v.inventory >= 20)?.id ?? detail.body.data.variants[0].id
    const other = list.body.data.items.find((i: any) => i.id !== product.id && i.stock >= 5)
    expect(other).toBeDefined()
    const otherDetail = await call(`/api/store/jamicore-store/products/${other.slug}`)
    replacementVariantId = otherDetail.body.data.variants.find((v: any) => v.inventory >= 2)?.id
    expect(replacementVariantId).toBeDefined()
  })

  it('counts fulfillment rows for pagination meta (not page length)', async () => {
    // Seed two fulfillments on distinct pending orders.
    const pending = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.merchantId, merchantId), eq(orders.status, 'pending')))
      .limit(2)
    expect(pending.length).toBe(2)
    for (const o of pending) {
      await call('/api/fulfillments', {
        method: 'POST',
        headers: { ...admin, ...jh },
        body: JSON.stringify({ orderId: o.id })
      })
    }
    const res = await call('/api/fulfillments?limit=1', { headers: admin })
    expect(res.status).toBe(200)
    expect(res.body.data.items).toHaveLength(1)
    expect(res.body.data.meta.total).toBeGreaterThanOrEqual(2)
    expect(res.body.data.meta.totalPages).toBeGreaterThanOrEqual(2)
  })

  it('serves a printable packing slip (JSON + HTML)', async () => {
    const list = await call('/api/fulfillments?limit=1', { headers: admin })
    const id = list.body.data.items[0].id
    const slip = await call(`/api/fulfillments/${id}/slip`, { headers: admin })
    expect(slip.status).toBe(200)
    expect(slip.body.data.order.orderNumber).toBeTruthy()
    expect(Array.isArray(slip.body.data.items)).toBe(true)
    expect(slip.body.data.totalQuantity).toBeGreaterThanOrEqual(0)

    const html = await call(`/api/fulfillments/${id}/slip?format=html`, { headers: admin })
    expect(html.status).toBe(200)
    expect((html.headers.get('content-type') ?? '').toLowerCase()).toContain('text/html')
    expect(Buffer.from(html.body as ArrayBuffer).toString('utf8')).toContain('Packing slip')
  })

  let draftInvoiceId = ''
  let paidOrderId = ''
  let unpaidOrderId = ''
  let paidInvoiceId = ''

  it('runs the invoice lifecycle draft→issued→paid', async () => {
    const [paidOrder] = await db
      .insert(orders)
      .values({
        merchantId,
        orderNumber: `GAP-PAID-${stamp}`,
        status: 'delivered',
        paymentStatus: 'paid',
        subtotal: 40,
        total: 40,
        currency: 'USD',
        orderType: 'ecommerce'
      })
      .returning()
    paidOrderId = paidOrder.id

    const created = await call('/api/invoices', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ orderId: paidOrderId })
    })
    expect(created.status).toBe(200)
    expect(created.body.data.status).toBe('draft')
    draftInvoiceId = created.body.data.id

    // draft → paid is illegal (must issue first).
    const skip = await call(`/api/invoices/${draftInvoiceId}/pay`, {
      method: 'POST',
      headers: { ...admin, ...jh }
    })
    expect(skip.status).toBe(400)
    expect(skip.body.error.code).toBe('INVALID_TRANSITION')

    const issued = await call(`/api/invoices/${draftInvoiceId}/issue`, {
      method: 'POST',
      headers: { ...admin, ...jh }
    })
    expect(issued.status).toBe(200)
    expect(issued.body.data.status).toBe('issued')
    paidInvoiceId = draftInvoiceId

    const paid = await call(`/api/invoices/${draftInvoiceId}/pay`, {
      method: 'POST',
      headers: { ...admin, ...jh }
    })
    expect(paid.status).toBe(200)
    expect(paid.body.data.status).toBe('paid')
  })

  it('blocks voiding an invoice on a paid order, allows it on unpaid', async () => {
    // paidInvoiceId is already `paid` (illegal from any state but issued).
    // For the money-moved guard, issue a credit note on the paid order: it is
    // `issued` while the order is `paid` → void must refuse with VOID_BLOCKED.
    const note = await call('/api/invoices', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ orderId: paidOrderId, type: 'credit_note' })
    })
    expect(note.status).toBe(200)
    await call(`/api/invoices/${note.body.data.id}/issue`, { method: 'POST', headers: { ...admin, ...jh } })
    const blocked = await call(`/api/invoices/${note.body.data.id}/void`, {
      method: 'POST',
      headers: { ...admin, ...jh }
    })
    expect(blocked.status).toBe(400)
    expect(blocked.body.error.code).toBe('INVOICE_VOID_BLOCKED')

    const [unpaid] = await db
      .insert(orders)
      .values({
        merchantId,
        orderNumber: `GAP-UNPAID-${stamp}`,
        status: 'pending',
        paymentStatus: 'unpaid',
        subtotal: 25,
        total: 25,
        currency: 'USD',
        orderType: 'ecommerce'
      })
      .returning()
    unpaidOrderId = unpaid.id
    const created = await call('/api/invoices', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ orderId: unpaidOrderId })
    })
    expect(created.status).toBe(200)
    const invId = created.body.data.id
    await call(`/api/invoices/${invId}/issue`, { method: 'POST', headers: { ...admin, ...jh } })
    const voided = await call(`/api/invoices/${invId}/void`, {
      method: 'POST',
      headers: { ...admin, ...jh }
    })
    expect(voided.status).toBe(200)
    expect(voided.body.data.status).toBe('void')
  })

  it('sends an invoice email and filters the list', async () => {
    const sent = await call(`/api/invoices/${paidInvoiceId}/send`, {
      method: 'POST',
      headers: { ...admin, ...jh }
    })
    // Guest order has no customer email → still 200 with sent:true (no-op send).
    expect(sent.status).toBe(200)
    expect(sent.body.data.sent).toBe(true)

    const byStatus = await call('/api/invoices?status=paid', { headers: admin })
    expect(byStatus.status).toBe(200)
    expect(byStatus.body.data.items.some((i: any) => i.id === paidInvoiceId)).toBe(true)

    const inv = await call(`/api/invoices/${paidInvoiceId}`, { headers: admin })
    const bySearch = await call(`/api/invoices?search=${encodeURIComponent(String(inv.body.data.invoiceNumber).slice(0, 8))}`, { headers: admin })
    expect(bySearch.status).toBe(200)
    expect(bySearch.body.data.items.some((i: any) => i.id === paidInvoiceId)).toBe(true)
  })

  it('guards invoice reads (401 without a session)', async () => {
    const res = await call('/api/invoices')
    expect(res.status).toBe(401)
    const one = await call(`/api/invoices/${paidInvoiceId}`)
    expect(one.status).toBe(401)
  })

  it('credits store-credit refunds to the customer balance', async () => {
    const email = `credit-${stamp}@example.com`
    const [customer] = await db
      .insert(customers)
      .values({ merchantId, email, firstName: 'Credit', ordersCount: 0 })
      .returning()
    const [order] = await db
      .insert(orders)
      .values({
        merchantId,
        customerId: customer.id,
        orderNumber: `GAP-CR-${stamp}`,
        status: 'delivered',
        paymentStatus: 'paid',
        subtotal: 60,
        total: 60,
        currency: 'USD',
        orderType: 'ecommerce'
      })
      .returning()

    const refund = await call('/api/refunds', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ orderId: order.id, amount: 15, method: 'store_credit' })
    })
    expect(refund.status).toBe(200)
    expect(refund.body.data.status).toBe('completed')

    const [fresh] = await db.select().from(customers).where(eq(customers.id, customer.id))
    expect(Number(fresh.storeCredit)).toBeCloseTo(15)

    const bogus = await call('/api/refunds', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ orderId: order.id, amount: 1, method: 'wallet' })
    })
    expect(bogus.status).toBe(400)
  })

  it('spends store credit at checkout and snapshots VAT per line', async () => {
    const email = `spender-${stamp}@example.com`
    await db.insert(customers).values({ merchantId, email, firstName: 'Spender', storeCredit: 50 })

    // Weight-tiered rule with an ETA: matches any order up to 100kg.
    const ship = await call('/api/settings/shipping', {
      method: 'PUT',
      headers: { ...admin, ...jh },
      body: JSON.stringify({
        rules: [
          { id: 'gap-std', type: 'default', name: 'Gap Standard', rate: 5, enabled: true, etaDays: 3, weightMin: 0, weightMax: 100 }
        ]
      })
    })
    expect(ship.status).toBe(200)

    const preview = await call(
      '/api/store/jamicore-store/checkout/preview',
      json({
        items: [{ productId: product.id, variantId, quantity: 1 }],
        shippingAddress: NY,
        email,
        useStoreCredit: true
      })
    )
    expect(preview.status).toBe(200)
    expect(preview.body.data.storeCreditUsed).toBeGreaterThan(0)
    expect(preview.body.data.shipping.etaDays).toBe(3)

    const before = preview.body.data
    const res = await call(
      '/api/store/jamicore-store/checkout',
      json({
        items: [{ productId: product.id, variantId, quantity: 1 }],
        email,
        shippingAddress: NY,
        paymentMethod: 'cod',
        useStoreCredit: true
      })
    )
    expect(res.status).toBe(200)
    expect(res.body.data.storeCreditUsed).toBeCloseTo(before.storeCreditUsed)
    expect(res.body.data.total).toBeCloseTo(before.total)

    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.merchantId, merchantId), eq(orders.orderNumber, res.body.data.orderNumber)))
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id))
    expect(lines.length).toBe(1)
    // US-NY merchant tax rate snapshot.
    expect(Number(lines[0].vatRate)).toBeCloseTo(8.875)

    const [holder] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.merchantId, merchantId), eq(customers.email, email)))
    expect(Number(holder.storeCredit)).toBeCloseTo(50 - before.storeCreditUsed)
  })

  let shopperToken = ''
  const shopperEmail = `selfserve-${stamp}@example.com`
  let ownOrderId = ''
  let ownOrderNumber = ''

  it('registers a shopper and exposes the store-credit balance', async () => {
    const placed = await guestCheckout(shopperEmail)
    expect(placed.status).toBe(200)
    ownOrderNumber = placed.body.data.orderNumber

    const reg = await call(
      '/api/store/jamicore-store/auth/register',
      json({ email: shopperEmail, password: 'Selfserve-12345', orderNumber: ownOrderNumber })
    )
    expect(reg.status).toBe(200)
    shopperToken = reg.body.data.token

    const me = await call('/api/store/jamicore-store/auth/me', get('', shopperToken))
    expect(me.status).toBe(200)
    expect(me.body.data).toHaveProperty('storeCredit')
  })

  it('lets the shopper cancel their own pending order', async () => {
    const mine = await db
      .select()
      .from(orders)
      .where(and(eq(orders.merchantId, merchantId), eq(orders.orderNumber, ownOrderNumber)))
    ownOrderId = mine[0].id

    const res = await call(
      `/api/store/jamicore-store/auth/orders/${ownOrderId}/cancel`,
      { method: 'POST', headers: { authorization: `Bearer ${shopperToken}` } }
    )
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('cancelled')

    // Someone else's order is invisible (404, no enumeration).
    const foreign = await guestCheckout(`foreign-${stamp}@example.com`)
    const foreignId = (
      await db
        .select()
        .from(orders)
        .where(and(eq(orders.merchantId, merchantId), eq(orders.orderNumber, foreign.body.data.orderNumber)))
    )[0].id
    const denied = await call(
      `/api/store/jamicore-store/auth/orders/${foreignId}/cancel`,
      { method: 'POST', headers: { authorization: `Bearer ${shopperToken}` } }
    )
    expect(denied.status).toBe(404)
  })

  it('lets the shopper request a return; admin approves as exchange', async () => {
    const placed = await guestCheckout(shopperEmail)
    expect(placed.status).toBe(200)
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.merchantId, merchantId), eq(orders.orderNumber, placed.body.data.orderNumber)))
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id))

    const req = await call(
      `/api/store/jamicore-store/auth/orders/${order.id}/returns`,
      json({ orderItemId: line.id, quantity: 1, reason: 'wrong size' }, shopperToken)
    )
    expect(req.status).toBe(200)
    expect(req.body.data.status).toBe('pending')
    const returnId = req.body.data.id

    const [variantBefore] = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, replacementVariantId))

    const approved = await call(`/api/returns/${returnId}`, {
      method: 'PATCH',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ status: 'approved', replacementVariantId })
    })
    expect(approved.status).toBe(200)
    const exchange = approved.body.data.exchangeOrder
    expect(exchange).toBeDefined()
    expect(exchange.orderNumber).toMatch(/^#X-/)
    expect(exchange.total).toBeCloseTo(Number(line.total))
    expect(exchange.notes).toContain(order.orderNumber)

    const [variantAfter] = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, replacementVariantId))
    expect(variantAfter.inventory).toBe(variantBefore.inventory - 1)
  })

  it('cleans up gap fixtures', async () => {
    // Order deletes cascade to items/invoices/returns/refunds; fulfillments
    // and inventory logs are removed explicitly.
    await db.delete(fulfillments).where(eq(fulfillments.merchantId, merchantId))
    await db.delete(inventoryLogs).where(and(eq(inventoryLogs.merchantId, merchantId), like(inventoryLogs.reference, 'GAP-%')))
    await db.delete(inventoryLogs).where(and(eq(inventoryLogs.merchantId, merchantId), like(inventoryLogs.reference, '#X-%')))
    await db.delete(inventoryLogs).where(and(eq(inventoryLogs.merchantId, merchantId), like(inventoryLogs.reference, '#W%')))
    await db.delete(orders).where(and(eq(orders.merchantId, merchantId), like(orders.orderNumber, 'GAP-%')))
    await db.delete(orders).where(and(eq(orders.merchantId, merchantId), like(orders.orderNumber, '#X-%')))
    await db.delete(orders).where(and(eq(orders.merchantId, merchantId), like(orders.orderNumber, '#W%')))
    await db.delete(customers).where(and(eq(customers.merchantId, merchantId), like(customers.email, `%-${stamp}@example.com`)))
  })
})
