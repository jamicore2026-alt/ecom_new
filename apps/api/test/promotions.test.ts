import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq, like, or, sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { app } from '../src/app'
import { db } from '../src/database/client'
import {
  categories,
  coupons,
  customers,
  merchants,
  orderItems,
  orders,
  productVariants,
  products,
  promotions,
  refunds,
  returnsTable
} from '../src/database/schema'
import { OrdersService } from '../src/modules/orders/service'

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
  name: 'Promo Tester',
  line1: '1 Promo Way',
  city: 'Austin',
  state: 'TX',
  postalCode: '73301',
  country: 'US'
}

const daysFromNow = (d: number) => new Date(Date.now() + d * 24 * 60 * 60 * 1000)

describe('P0 closure — promotions, cancellation routing, refund idempotency', () => {
  let adminToken = ''
  let merchantId = ''
  let productId = ''
  let variantId = ''
  let categoryId = ''
  let otherProductId = ''
  let rivalMerchantId = ''
  const promoIds: string[] = []
  const emails = new Set<string>()

  const placeOrder = async (
    paymentMethod: 'cod' | 'card',
    opts: { email?: string; couponCode?: string } = {}
  ) => {
    const email = opts.email ?? `promo-${createId().slice(0, 8)}@test.local`
    emails.add(email)
    return call(
      '/api/store/acme-store/checkout',
      json({
        items: [{ productId, variantId, quantity: 1 }],
        email,
        shippingAddress: ADDRESS,
        paymentMethod,
        ...(opts.couponCode ? { couponCode: opts.couponCode } : {})
      })
    )
  }

  beforeAll(async () => {
    const login = await call(
      '/api/auth/login',
      json({ email: 'admin@acme.com', password: 'password123' })
    )
    adminToken = login.body.data.accessToken

    const [merchant] = await db.select().from(merchants).where(eq(merchants.slug, 'acme-store'))
    merchantId = merchant.id

    // Category-scoped fixture needs a real category
    const catRes = await call('/api/categories', json({ name: `PromoCat-${createId().slice(0, 6)}` }, adminToken))
    categoryId = catRes.body.data.id

    const created = await call(
      '/api/products',
      json(
        {
          sku: `PROMO-${createId().slice(0, 6)}`,
          name: 'Promotion Fixture',
          price: 100,
          status: 'active',
          trackInventory: true,
          categoryId,
          variants: [{ sku: `PROMO-V-${createId().slice(0, 4)}`, optionValues: {}, inventory: 100 }]
        },
        adminToken
      )
    )
    expect(created.status).toBe(200)
    productId = created.body.data.id
    variantId = created.body.data.variants[0].id

    // Rival tenant for isolation checks
    const [rival] = await db
      .insert(merchants)
      .values({
        name: 'Rival Two',
        slug: `rival-two-${createId().slice(0, 8)}`,
        email: `rival-${createId().slice(0, 8)}@test.local`,
        currency: 'USD',
        timezone: 'UTC',
        status: 'active'
      })
      .returning()
    rivalMerchantId = rival.id
    const [rivalPromo] = await db
      .insert(promotions)
      .values({
        merchantId: rivalMerchantId,
        name: 'Rival 90% Off',
        type: 'discount_on_products',
        discountPercent: 90,
        appliesTo: { scope: 'all' },
        status: 'active'
      })
      .returning()
    promoIds.push(rivalPromo.id)
  })

  /* ------------------------- promotion resolution ------------------------- */

  it('applies an active all-scope promotion automatically, identically in preview and checkout', async () => {
    const [promo] = await db
      .insert(promotions)
      .values({
        merchantId,
        name: 'Active All 10%',
        type: 'discount_on_products',
        discountPercent: 10,
        appliesTo: { scope: 'all' },
        startsAt: daysFromNow(-1),
        endsAt: daysFromNow(30),
        status: 'active'
      })
      .returning()
    promoIds.push(promo.id)

    const preview = await call('/api/store/acme-store/checkout/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ productId, variantId, quantity: 1 }] })
    })
    expect(preview.status).toBe(200)
    expect(preview.body.data.promotion.name).toBe('Active All 10%')
    expect(preview.body.data.discountTotal).toBeCloseTo(10) // 10% of 100
    expect(preview.body.data.total).toBeCloseTo(preview.body.data.subtotal - 10 + preview.body.data.shippingTotal + preview.body.data.taxTotal)

    const placed = await placeOrder('card')
    expect(placed.status).toBe(200)
    expect(placed.body.data.total).toBe(preview.body.data.total)

    const [orderRow] = await db
      .select({ promotionId: orders.promotionId, discountTotal: orders.discountTotal })
      .from(orders)
      .where(eq(orders.orderNumber, placed.body.data.orderNumber))
    expect(orderRow.promotionId).toBe(promo.id)
    expect(Number(orderRow.discountTotal)).toBeCloseTo(10)
  })

  it('ignores expired, future and disabled promotions', async () => {
    const [expired] = await db
      .insert(promotions)
      .values({
        merchantId, name: 'Expired 80%', type: 'discount_on_products', discountPercent: 80,
        appliesTo: { scope: 'all' }, startsAt: daysFromNow(-30), endsAt: daysFromNow(-1), status: 'active'
      })
      .returning()
    const [future] = await db
      .insert(promotions)
      .values({
        merchantId, name: 'Future 70%', type: 'discount_on_products', discountPercent: 70,
        appliesTo: { scope: 'all' }, startsAt: daysFromNow(7), status: 'active'
      })
      .returning()
    const [disabled] = await db
      .insert(promotions)
      .values({
        merchantId, name: 'Disabled 60%', type: 'discount_on_products', discountPercent: 60,
        appliesTo: { scope: 'all' }, status: 'disabled'
      })
      .returning()
    promoIds.push(expired.id, future.id, disabled.id)

    const preview = await call('/api/store/acme-store/checkout/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ productId, variantId, quantity: 1 }] })
    })
    expect(preview.status).toBe(200)
    expect(preview.body.data.promotion.name).not.toBe('Expired 80%')
    expect(preview.body.data.promotion.name).not.toBe('Future 70%')
    expect(preview.body.data.promotion.name).not.toBe('Disabled 60%')
  })

  it('scopes product/category promotions to matching lines and stacks safely with coupons', async () => {
    const other = await call(
      '/api/products',
      json(
        {
          sku: `PROMO-OTHER-${createId().slice(0, 4)}`,
          name: 'Other Product',
          price: 40,
          status: 'active',
          variants: [{ sku: `PO-V-${createId().slice(0, 4)}`, optionValues: {}, inventory: 20 }]
        },
        adminToken
      )
    )
    otherProductId = other.body.data.id

    const [productScoped] = await db
      .insert(promotions)
      .values({
        merchantId, name: 'Fixture Only 25%', type: 'discount_on_products', discountPercent: 25,
        appliesTo: { scope: 'products', productIds: [productId] }, status: 'active'
      })
      .returning()
    const [categoryScoped] = await db
      .insert(promotions)
      .values({
        merchantId, name: 'Category 15%', type: 'discount_on_products', discountPercent: 15,
        appliesTo: { scope: 'category', categoryId }, status: 'active'
      })
      .returning()
    promoIds.push(productScoped.id, categoryScoped.id)

    // Best single promotion wins: 25% of 100 = 25 beats category 15.
    const preview = await call('/api/store/acme-store/checkout/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [
          { productId, variantId, quantity: 1 },
          { productId: other.body.data.id, variantId: other.body.data.variants[0].id, quantity: 1 }
        ],
        couponCode: 'WELCOME15'
      })
    })
    expect(preview.status).toBe(200)
    const d = preview.body.data
    expect(d.promotion.name).toBe('Fixture Only 25%')
    // subtotal 140; best promo = 25% of the matched fixture line (100) = 25;
    // coupon % computes on the full subtotal (140 × 15% = 21); combined ≤ subtotal
    expect(d.discountTotal).toBeCloseTo(Math.min(25 + 140 * 0.15, 140))

    // Disable the 25% product promo so the B2G1 rule is the best match.
    await db.update(promotions).set({ status: 'disabled' }).where(eq(promotions.id, productScoped.id))

    const [buyXGety] = await db
      .insert(promotions)
      .values({
        merchantId, name: 'B2G1 Half', type: 'buy_x_get_y', discountPercent: 50,
        buyQty: 2, getQty: 1, appliesTo: { scope: 'products', productIds: [productId] }, status: 'active'
      })
      .returning()
    promoIds.push(buyXGety.id)

    const b2g1 = await call('/api/store/acme-store/checkout/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ productId, variantId, quantity: 3 }] })
    })
    expect(b2g1.status).toBe(200)
    // 3 units of 100 → one discounted unit at 50%
    expect(b2g1.body.data.discountTotal).toBeCloseTo(50)
  })

  it('never applies a cross-merchant promotion', async () => {
    const preview = await call('/api/store/acme-store/checkout/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ productId, variantId, quantity: 1 }] })
    })
    expect(preview.status).toBe(200)
    expect(preview.body.data.promotion.name).not.toBe('Rival 90% Off')
    expect(Number(preview.body.data.discountTotal)).toBeLessThan(90)
  })

  it('enforces promotion usage limits under concurrency', async () => {
    // Disable every OTHER active acme promo first, then insert the limited one
    // so it is the only match (the disable below must not touch it).
    await db
      .update(promotions)
      .set({ status: 'disabled' })
      .where(and(eq(promotions.merchantId, merchantId), eq(promotions.status, 'active')))

    const [limited] = await db
      .insert(promotions)
      .values({
        merchantId, name: 'Limited 5%', type: 'discount_on_products', discountPercent: 5,
        appliesTo: { scope: 'all' }, usageLimit: 2, status: 'active'
      })
      .returning()
    promoIds.push(limited.id)

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        placeOrder('card', { email: `limit-${i}-${createId().slice(0, 4)}@test.local` })
      )
    )
    const okCount = results.filter((r) => r.status === 200).length
    const limitedCount = results.filter((r) => r.body?.error?.code === 'PROMOTION_USAGE_LIMIT').length
    expect(okCount).toBe(2)
    expect(limitedCount).toBe(4)

    const [after] = await db.select().from(promotions).where(eq(promotions.id, limited.id))
    expect(after.usedCount).toBe(2)
  })

  /* --------------------- generic-status cancel routing --------------------- */

  it('routes PATCH {status: cancelled} through the authoritative cancellation', async () => {
    const [allScope] = await db
      .insert(promotions)
      .values({
        merchantId, name: 'Zero After Cancel', type: 'discount_on_products', discountPercent: 5,
        appliesTo: { scope: 'all' }, status: 'active'
      })
      .returning()
    promoIds.push(allScope.id)

    const invBefore = (
      await db.select().from(productVariants).where(eq(productVariants.id, variantId))
    )[0].inventory
    const [couponBefore] = await db.select().from(coupons).where(eq(coupons.code, 'WELCOME15'))

    const placed = await placeOrder('cod', { couponCode: 'WELCOME15' })
    expect(placed.status).toBe(200)
    const [orderRow] = await db.select({ id: orders.id }).from(orders).where(eq(orders.orderNumber, placed.body.data.orderNumber))

    const patched = await call(`/api/orders/${orderRow.id}/status`, patch({ status: 'cancelled' }, adminToken))
    expect(patched.status).toBe(200)
    expect(patched.body.data.status).toBe('cancelled')
    expect(patched.body.data.paymentStatus).toBe('failed')

    const invAfter = (
      await db.select().from(productVariants).where(eq(productVariants.id, variantId))
    )[0].inventory
    expect(invAfter).toBe(invBefore) // restocked by the authoritative op

    const [couponAfter] = await db.select().from(coupons).where(eq(coupons.code, 'WELCOME15'))
    expect(Number(couponAfter.usedCount)).toBe(Number(couponBefore.usedCount)) // restored
  })

  it('rejects cancelling a paid order even through the generic endpoint', async () => {
    const placed = await placeOrder('card')
    const [orderRow] = await db.select({ id: orders.id }).from(orders).where(eq(orders.orderNumber, placed.body.data.orderNumber))
    const res = await call(`/api/orders/${orderRow.id}/status`, patch({ status: 'cancelled' }, adminToken))
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('REFUND_REQUIRED')
  })

  /* --------------------------- refund idempotency -------------------------- */

  it('returns the same refund for a repeated idempotency key', async () => {
    const placed = await placeOrder('card')
    const [orderRow] = await db.select({ id: orders.id }).from(orders).where(eq(orders.orderNumber, placed.body.data.orderNumber))
    const key = createId()

    const first = await call(
      '/api/refunds',
      json({ orderId: orderRow.id, amount: 10, idempotencyKey: key }, adminToken)
    )
    expect(first.status).toBe(200)
    const second = await call(
      '/api/refunds',
      json({ orderId: orderRow.id, amount: 10, idempotencyKey: key }, adminToken)
    )
    expect(second.status).toBe(200)
    expect(second.body.data.id).toBe(first.body.data.id)

    const rows = await db.select().from(refunds).where(eq(refunds.orderId, orderRow.id))
    expect(rows).toHaveLength(1)
    expect(rows[0].idempotencyKey).toBe(key)
  })

  it('reconciles stale pending refunds and supports retry', async () => {
    const placed = await placeOrder('card')
    const [orderRow] = await db.select({ id: orders.id }).from(orders).where(eq(orders.orderNumber, placed.body.data.orderNumber))

    // Simulate a crash between reservation and resolution: hand-insert a stale pending row.
    const [stale] = await db
      .insert(refunds)
      .values({
        merchantId,
        orderId: orderRow.id,
        amount: 5,
        method: 'original',
        status: 'pending',
        idempotencyKey: createId(),
        createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000)
      })
      .returning()

    await OrdersService.reconcileStaleRefunds()
    const [released] = await db.select().from(refunds).where(eq(refunds.id, stale.id))
    expect(released.status).toBe('failed')
    expect(released.lastError).toContain('reconciliation')

    // Retry pushes it through (manual/no-provider order → settles immediately).
    const retried = await call(`/api/refunds/${stale.id}/retry`, json({}, adminToken))
    expect(retried.status).toBe(200)
    expect(retried.body.data.status).toBe('completed')
    expect(retried.body.data.attemptCount).toBe(2)

    // Retrying a completed refund is an idempotent no-op.
    const again = await call(`/api/refunds/${stale.id}/retry`, json({}, adminToken))
    expect(again.status).toBe(200)
    expect(again.body.data.attemptCount).toBe(2)
  })

  afterAll(async () => {
    const safe = (fn: () => Promise<unknown>) => fn().catch(() => undefined)

    // Restore inventory consumed by test orders before deleting them
    await safe(async () => {
      const list = await db
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.merchantId, merchantId ?? ''), like(orders.orderNumber, '#W%')))
      for (const o of list) {
        const items = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id))
        for (const item of items) {
          if (!item.variantId) continue
          await db
            .update(productVariants)
            .set({ inventory: sql`${productVariants.inventory} + ${item.quantity}` })
            .where(eq(productVariants.id, item.variantId))
        }
        await db.delete(refunds).where(eq(refunds.orderId, o.id))
        await db.delete(returnsTable).where(eq(returnsTable.orderId, o.id))
      }
      await db.delete(orders).where(and(eq(orders.merchantId, merchantId ?? ''), like(orders.orderNumber, '#W%')))
    })

    await safe(async () => {
      if (emails.size && merchantId) {
        for (const email of emails) {
          await db.delete(customers).where(and(eq(customers.merchantId, merchantId), eq(customers.email, email)))
        }
      }
    })

    await safe(() =>
      db
        .update(coupons)
        .set({ usedCount: 410 })
        .where(and(eq(coupons.merchantId, merchantId ?? ''), eq(coupons.code, 'WELCOME15')))
    )

    // Re-enable seeded promotions that were disabled by the usage-limit test
    await safe(() =>
      db
        .update(promotions)
        .set({ status: 'active' })
        .where(
          and(
            eq(promotions.merchantId, merchantId ?? ''),
            or(
              eq(promotions.name, 'Summer Sale'),
              eq(promotions.name, 'Buy 2 Tees Get 1 Half Price')
            )
          )
        )
    )

    await safe(async () => { if (productId) await db.delete(products).where(eq(products.id, productId)) })
    await safe(async () => { if (otherProductId) await db.delete(products).where(eq(products.id, otherProductId)) })
    await safe(async () => { if (categoryId) await db.delete(categories).where(eq(categories.id, categoryId)) })

    if (rivalMerchantId) {
      await safe(() => db.delete(promotions).where(eq(promotions.merchantId, rivalMerchantId)))
      await safe(() => db.delete(products).where(eq(products.merchantId, rivalMerchantId)))
      await safe(() => db.delete(merchants).where(eq(merchants.id, rivalMerchantId)))
    }

    // Delete all test-created promotions
    for (const pid of promoIds) {
      if (!pid) continue
      await safe(() => db.delete(promotions).where(eq(promotions.id, pid)))
    }
  })
})
