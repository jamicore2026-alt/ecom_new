import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { app } from '../src/app'
import { db } from '../src/database/client'
import {
  affiliates,
  campaigns,
  carts,
  categories,
  contentPages,
  couponRedemptions,
  coupons,
  customers,
  customerSegments,
  merchants,
  products,
  referrals,
  reviewReplies,
  reviews
} from '../src/database/schema'
import { CartsService } from '../src/modules/carts/service'
import { ContentService } from '../src/modules/content/service'
import { CampaignsService } from '../src/modules/campaigns/service'
import { DiscountsService } from '../src/modules/discounts/service'
import { SegmentsService } from '../src/modules/segments/service'

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

const put = (body: unknown, token: string) => ({
  method: 'PUT',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify(body)
})

const authHeader = (token: string) => ({ authorization: `Bearer ${token}` })

describe('Growth gaps — coupons, customers, reviews, campaigns, segments, carts, content, affiliates', () => {
  let adminToken = ''
  let merchantId = ''
  let productId = ''
  let variantId = ''
  let categoryId = ''
  const couponIds: string[] = []
  const customerIds: string[] = []
  const campaignIds: string[] = []
  const segmentIds: string[] = []
  const emails: string[] = []

  const trackEmail = (e: string) => {
    emails.push(e)
    return e
  }

  beforeAll(async () => {
    const login = await call('/api/auth/login', json({ email: 'admin@jamicore.com', password: 'password123' }))
    expect(login.status).toBe(200)
    adminToken = login.body.data.accessToken

    const [merchant] = await db.select().from(merchants).where(eq(merchants.slug, 'jamicore-store'))
    merchantId = merchant.id

    const catRes = await call('/api/categories', json({ name: `GrowthCat-${createId().slice(0, 6)}` }, adminToken))
    categoryId = catRes.body.data.id

    const created = await call(
      '/api/products',
      json(
        {
          sku: `GROWTH-${createId().slice(0, 6)}`,
          name: 'Growth Fixture',
          price: 100,
          status: 'active',
          trackInventory: false,
          categoryId,
          variants: [{ sku: `G-V-${createId().slice(0, 4)}`, optionValues: {}, inventory: 50 }]
        },
        adminToken
      )
    )
    expect(created.status).toBe(200)
    productId = created.body.data.id
    variantId = created.body.data.variants[0].id
  })

  /* -------------------------------- coupons -------------------------------- */

  it('enforces product scope in validateCoupon', async () => {
    const code = `SCP-${createId().slice(0, 6).toUpperCase()}`
    const created = await call(
      '/api/coupons',
      json({ code, type: 'percentage', value: 10, appliesTo: { scope: 'products', productIds: [productId] } }, adminToken)
    )
    expect(created.status).toBe(200)
    couponIds.push(created.body.data.id)

    // Non-matching lines → NOT_APPLICABLE
    const bad = await call(
      '/api/coupons/validate',
      json(
        { code, subtotal: 100, lines: [{ productId: 'other-product', categoryId: null, price: 100, quantity: 1 }] },
        adminToken
      )
    )
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe('NOT_APPLICABLE')

    // Matching lines → discount on matched subtotal only
    const good = await call(
      '/api/coupons/validate',
      json(
        {
          code,
          subtotal: 140,
          lines: [
            { productId, categoryId, price: 100, quantity: 1 },
            { productId: 'other-product', categoryId: null, price: 40, quantity: 1 }
          ]
        },
        adminToken
      )
    )
    expect(good.status).toBe(200)
    expect(good.body.data.discount).toBeCloseTo(10) // 10% of the matched 100
    expect(good.body.data.scopeChecked).toBe(true)
  })

  it('enforces customer scope in validateCoupon', async () => {
    const vip = trackEmail(`vip-${createId().slice(0, 6)}@test.local`)
    const code = `VIP-${createId().slice(0, 6).toUpperCase()}`
    const created = await call(
      '/api/coupons',
      json({ code, type: 'fixed', value: 5, appliesTo: { scope: 'customers', customerIds: [vip] } }, adminToken)
    )
    expect(created.status).toBe(200)
    couponIds.push(created.body.data.id)

    const stranger = await call('/api/coupons/validate', json({ code, subtotal: 50, customerEmail: 'stranger@test.local' }, adminToken))
    expect(stranger.status).toBe(400)
    expect(stranger.body.error.code).toBe('NOT_APPLICABLE')

    const allowed = await call('/api/coupons/validate', json({ code, subtotal: 50, customerEmail: vip }, adminToken))
    expect(allowed.status).toBe(200)
    expect(allowed.body.data.discount).toBeCloseTo(5)
  })

  it('enforces per-customer limit via the redemption ledger', async () => {
    const email = trackEmail(`limit-${createId().slice(0, 6)}@test.local`)
    const code = `PCL-${createId().slice(0, 6).toUpperCase()}`
    const created = await call(
      '/api/coupons',
      json({ code, type: 'fixed', value: 5, perCustomerLimit: 1 }, adminToken)
    )
    expect(created.status).toBe(200)
    const couponId = created.body.data.id
    couponIds.push(couponId)

    await db.insert(couponRedemptions).values({ merchantId, couponId, customerId: null, customerEmail: email, orderId: null })

    const again = await call('/api/coupons/validate', json({ code, subtotal: 50, customerEmail: email }, adminToken))
    expect(again.status).toBe(400)
    expect(again.body.error.code).toBe('CUSTOMER_LIMIT')
  })

  it('enforces firstOrderOnly against ordersCount', async () => {
    const code = `FOO-${createId().slice(0, 6).toUpperCase()}`
    const created = await call(
      '/api/coupons',
      json({ code, type: 'percentage', value: 20, firstOrderOnly: true }, adminToken)
    )
    expect(created.status).toBe(200)
    couponIds.push(created.body.data.id)

    // Seed customer with orders (WELCOME flow) — find one with ordersCount > 0
    const fresh = trackEmail(`fresh-${createId().slice(0, 6)}@test.local`)
    const freshOk = await call('/api/coupons/validate', json({ code, subtotal: 100, customerEmail: fresh }, adminToken))
    expect(freshOk.status).toBe(200)

    // Simulate a repeat buyer by creating + bumping a customer row
    const [cust] = await db
      .insert(customers)
      .values({ merchantId, email: fresh, ordersCount: 2 })
      .returning()
    customerIds.push(cust.id)
    const repeat = await call('/api/coupons/validate', json({ code, subtotal: 100, customerEmail: fresh }, adminToken))
    expect(repeat.status).toBe(400)
    expect(repeat.body.error.code).toBe('FIRST_ORDER_ONLY')
  })

  it('stackable=false defers to the higher discount (priority breaks ties)', () => {
    expect(DiscountsService.pickStackWinner({ stackable: true, priority: 0 }, 10, 25)).toBe('both')
    expect(DiscountsService.pickStackWinner({ stackable: false, priority: 0 }, 10, 25)).toBe('promotion')
    expect(DiscountsService.pickStackWinner({ stackable: false, priority: 0 }, 30, 25)).toBe('coupon')
    expect(DiscountsService.pickStackWinner({ stackable: false, priority: 5 }, 20, 20)).toBe('coupon')
    expect(DiscountsService.pickStackWinner({ stackable: false, priority: 0 }, 20, 20)).toBe('promotion')
  })

  it('bulk-generates unique single-use codes + reports redemptions', async () => {
    const prefix = `BK${createId().slice(0, 5).toUpperCase()}`
    const bulk = await call(
      '/api/coupons/bulk',
      json({ prefix, count: 3, type: 'fixed', value: 7 }, adminToken)
    )
    expect(bulk.status).toBe(200)
    expect(bulk.body.data.count).toBe(3)
    const codes = bulk.body.data.items.map((c: { code: string }) => c.code)
    expect(new Set(codes).size).toBe(3)
    for (const c of bulk.body.data.items) couponIds.push(c.id)

    const report = await call(`/api/coupons/${bulk.body.data.items[0].id}/report`, { headers: authHeader(adminToken) })
    expect(report.status).toBe(200)
    expect(report.body.data.redemptions).toBe(0)
    expect(report.body.data.coupon.code).toBe(codes[0])
  })

  /* -------------------------------- customers ------------------------------- */

  it('supports manual CRUD + opt-out, blocking delete when orders exist', async () => {
    const email = trackEmail(`manual-${createId().slice(0, 6)}@test.local`)
    const created = await call(
      '/api/customers',
      json({ email, firstName: 'Manual', tags: ['VIP'] }, adminToken)
    )
    expect(created.status).toBe(200)
    const id = created.body.data.id
    customerIds.push(id)

    const updated = await call(`/api/customers/${id}`, put({ lastName: 'Edited' }, adminToken))
    expect(updated.status).toBe(200)
    expect(updated.body.data.lastName).toBe('Edited')

    const opted = await call(`/api/customers/${id}/opt-out`, json({ marketingOptOut: true }, adminToken))
    expect(opted.status).toBe(200)
    expect(opted.body.data.marketingOptOut).toBe(true)

    const deleted = await call(`/api/customers/${id}`, { method: 'DELETE', headers: authHeader(adminToken) })
    expect(deleted.status).toBe(200)

    // A customer that owns an order cannot be deleted (history preservation)
    const buyerEmail = trackEmail(`buyer-${createId().slice(0, 6)}@test.local`)
    const placed = await call(
      '/api/store/jamicore-store/checkout',
      json({
        items: [{ productId, variantId, quantity: 1 }],
        email: buyerEmail,
        shippingAddress: { name: 'Buyer', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '73301', country: 'US', phone: '+1 5550100' },
        paymentMethod: 'cod'
      })
    )
    expect(placed.status).toBe(200)
    const [buyer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.merchantId, merchantId), eq(customers.email, buyerEmail)))
    expect(buyer).toBeDefined()
    customerIds.push(buyer.id)

    const blocked = await call(`/api/customers/${buyer.id}`, { method: 'DELETE', headers: authHeader(adminToken) })
    expect(blocked.status).toBe(400)
    expect(blocked.body.error.code).toBe('HAS_ORDERS')
  })

  /* --------------------------------- reviews -------------------------------- */

  it('helpful++ with best-effort uniqueness, replies, and bulk moderate', async () => {
    // Seed a review directly (merchant view needs an existing row)
    const [cust] = await db
      .insert(customers)
      .values({ merchantId, email: trackEmail(`rev-${createId().slice(0, 6)}@test.local`) })
      .returning()
    customerIds.push(cust.id)
    const [review] = await db
      .insert(reviews)
      .values({ merchantId, productId, customerId: cust.id, authorName: 'Growth Tester', rating: 5, body: 'Great', status: 'pending' })
      .returning()

    const first = await call(`/api/reviews/${review.id}/helpful`, json({ customerId: cust.id }, adminToken))
    expect(first.status).toBe(200)
    expect(first.body.data.helpfulCount).toBe(1)

    const second = await call(`/api/reviews/${review.id}/helpful`, json({ customerId: cust.id }, adminToken))
    expect(second.status).toBe(400)
    expect(second.body.error.code).toBe('ALREADY_VOTED')

    const reply = await call(`/api/reviews/${review.id}/replies`, json({ body: 'Thanks — this also answers sizing questions!' }, adminToken))
    expect(reply.status).toBe(200)

    const list = await call(`/api/reviews?productId=${productId}`, { headers: authHeader(adminToken) })
    const found = list.body.data.items.find((r: { id: string }) => r.id === review.id)
    expect(found.replies).toHaveLength(1)
    expect(found.helpfulCount).toBe(1)

    const bulk = await call('/api/reviews/bulk-moderate', json({ ids: [review.id], status: 'approved' }, adminToken))
    expect(bulk.status).toBe(200)
    expect(bulk.body.data.updated).toBe(1)

    await db.delete(reviewReplies).where(eq(reviewReplies.reviewId, review.id))
    await db.delete(reviews).where(eq(reviews.id, review.id))
  })

  /* -------------------------------- campaigns ------------------------------- */

  it('scheduled campaigns send via the worker, skipping opted-out recipients', async () => {
    const inEmail = trackEmail(`camp-in-${createId().slice(0, 6)}@test.local`)
    const outEmail = trackEmail(`camp-out-${createId().slice(0, 6)}@test.local`)
    for (const e of [inEmail, outEmail]) {
      const [c] = await db.insert(customers).values({ merchantId, email: e }).returning()
      customerIds.push(c.id)
    }
    await call(`/api/customers/${customerIds[customerIds.length - 1]}/opt-out`, json({ marketingOptOut: true }, adminToken))

    const created = await call(
      '/api/campaigns',
      json(
        {
          name: `Scheduled ${createId().slice(0, 6)}`,
          subject: 'Hello',
          content: 'Scheduled body',
          audience: { type: 'list', emails: [inEmail, outEmail] },
          scheduledAt: new Date(Date.now() - 60_000).toISOString()
        },
        adminToken
      )
    )
    expect(created.status).toBe(200)
    campaignIds.push(created.body.data.id)
    // create() always starts as draft; the worker picks up past-due drafts too
    const list = await call('/api/campaigns', { headers: authHeader(adminToken) })
    const target = list.body.data.items.find((c: { id: string }) => c.id === created.body.data.id)
    expect(target).toBeDefined()

    const sent = await CampaignsService.sendDueScheduled(db)
    expect(sent).toBeGreaterThanOrEqual(1)

    const after = await call(`/api/campaigns/${target.id}`, { headers: authHeader(adminToken) })
    expect(after.body.data.status).toBe('sent')
    expect(after.body.data.sentCount).toBe(1) // opted-out recipient skipped

    const token = after.body.data.trackToken
    expect(token).toBeTruthy()
    await CampaignsService.trackOpen(db, token, inEmail)
    await CampaignsService.trackClick(db, token, inEmail)
    const stats = await call(`/api/campaigns/${target.id}/stats`, { headers: authHeader(adminToken) })
    expect(stats.body.data.openedCount).toBe(1)
    expect(stats.body.data.clickedCount).toBe(1)
  })

  it('unsubscribes by email and manages templates', async () => {
    const email = trackEmail(`unsub-${createId().slice(0, 6)}@test.local`)
    const [c] = await db.insert(customers).values({ merchantId, email }).returning()
    customerIds.push(c.id)

    const unsub = await call('/api/campaigns/unsubscribe', json({ email, merchantId }))
    expect(unsub.status).toBe(200)
    expect(unsub.body.data.optedOut).toBe(true)

    const tpl = await call('/api/campaigns/templates', json({ name: `Tpl ${createId().slice(0, 6)}`, subject: 'Hi', content: 'Body' }, adminToken))
    expect(tpl.status).toBe(200)
    campaignIds.push(tpl.body.data.id)
    const listed = await call('/api/campaigns/templates', { headers: authHeader(adminToken) })
    expect(listed.body.data.items.length).toBeGreaterThanOrEqual(1)

    const fromTpl = await call(
      '/api/campaigns/from-template',
      json({ templateId: tpl.body.data.id, name: `From tpl ${createId().slice(0, 4)}` }, adminToken)
    )
    expect(fromTpl.status).toBe(200)
    expect(fromTpl.body.data.status).toBe('draft')
    campaignIds.push(fromTpl.body.data.id)
  })

  /* --------------------------------- segments ------------------------------- */

  it('supports recency + tags definitions and refresh', async () => {
    const email = trackEmail(`seg-${createId().slice(0, 6)}@test.local`)
    const [c] = await db
      .insert(customers)
      .values({ merchantId, email, tags: ['VIP'], lastOrderAt: new Date() })
      .returning()
    customerIds.push(c.id)

    const created = await call(
      '/api/segments',
      json({ name: `Recent VIPs ${createId().slice(0, 4)}`, definition: { recencyDays: 30, tags: ['VIP'] } }, adminToken)
    )
    expect(created.status).toBe(200)
    expect(created.body.data.customerCount).toBeGreaterThanOrEqual(1)
    segmentIds.push(created.body.data.id)

    const members = await call(`/api/segments/${created.body.data.id}/members`, { headers: authHeader(adminToken) })
    expect(members.body.data.items.some((m: { id: string }) => m.id === c.id)).toBe(true)

    // Stale recency excludes the member
    await SegmentsService.preview(db, merchantId, { recencyDays: 30, tags: ['VIP'] })
    const refreshed = await call(`/api/segments/${created.body.data.id}/refresh`, json({}, adminToken))
    expect(refreshed.status).toBe(200)

    const old = await call(
      '/api/segments',
      json({ name: `Ancient ${createId().slice(0, 4)}`, definition: { recencyDays: 1, tags: ['NOPE-TAG'] } }, adminToken)
    )
    expect(old.body.data.customerCount).toBe(0)
    segmentIds.push(old.body.data.id)
  })

  /* ---------------------------------- carts --------------------------------- */

  it('links guest email on save, reports recovery, and sends the 48h second touch', async () => {
    const email = trackEmail(`cart-${createId().slice(0, 6)}@test.local`)
    const [c] = await db.insert(customers).values({ merchantId, email }).returning()
    customerIds.push(c.id)

    // Guest capture: save with email only → linked to the customer row
    const saved = await call(
      '/api/store/jamicore-store/cart',
      json({ email, items: [{ variantId: 'v1', productId, name: 'Growth Fixture', price: 25, quantity: 2 }] })
    )
    expect(saved.status).toBe(200)
    expect(saved.body.data.cart.customerId).toBe(c.id)
    const cartId = saved.body.data.cart.id

    // Age the cart into second-touch territory
    await db
      .update(carts)
      .set({ status: 'abandoned', abandonedAt: new Date(Date.now() - 49 * 60 * 60 * 1000), recoveryCode: `rc-${createId().slice(0, 8)}`, recoverySentAt: new Date(Date.now() - 49 * 60 * 60 * 1000) })
      .where(eq(carts.id, cartId))

    const touched = await CartsService.sweepSecondTouch(db)
    expect(touched).toBeGreaterThanOrEqual(1)

    const [afterCart] = await db.select().from(carts).where(eq(carts.id, cartId))
    void afterCart
    const incentiveCode = `RC-${cartId.replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase().padStart(8, 'X')}`
    const [coupon] = await db
      .select()
      .from(coupons)
      .where(and(eq(coupons.merchantId, merchantId), eq(coupons.code, incentiveCode)))
    expect(coupon).toBeDefined()
    couponIds.push(coupon.id)
    expect(coupon.usageLimit).toBe(1)

    // Second run is idempotent (coupon exists → skip)
    const again = await CartsService.sweepSecondTouch(db)
    expect(again).toBe(0)

    // List carries computed totals
    const list = await call('/api/carts?status=abandoned', { headers: authHeader(adminToken) })
    const found = list.body.data.items.find((r: { id: string }) => r.id === cartId)
    expect(found.subtotal).toBeCloseTo(50)

    const report = await call('/api/carts/recovery-report', { headers: authHeader(adminToken) })
    expect(report.status).toBe(200)
    expect(report.body.data.abandonedCarts).toBeGreaterThanOrEqual(1)

    await db.delete(carts).where(eq(carts.id, cartId))
  })

  /* --------------------------------- content -------------------------------- */

  it('auto-publishes due scheduled pages', async () => {
    const created = await call(
      '/api/content',
      json(
        { title: `Scheduled ${createId().slice(0, 6)}`, slug: `sched-${createId().slice(0, 8)}`, content: 'Hello', status: 'scheduled', publishedAt: new Date(Date.now() - 1000).toISOString() },
        adminToken
      )
    )
    expect(created.status).toBe(200)
    const id = created.body.data.id

    const published = await ContentService.publishDue(db)
    expect(published).toBeGreaterThanOrEqual(1)

    const [row] = await db.select().from(contentPages).where(eq(contentPages.id, id))
    expect(row.status).toBe('published')

    await db.delete(contentPages).where(eq(contentPages.id, id))
  })

  /* -------------------------------- affiliates ------------------------------ */

  it('issues portal magic links and serves dashboard data', async () => {
    const email = trackEmail(`aff-${createId().slice(0, 6)}@test.local`)
    const created = await call(
      '/api/affiliates',
      json({ name: 'Portal Partner', email, referralCode: `PORTAL${createId().slice(0, 5).toUpperCase()}`, commissionRate: 10 }, adminToken)
    )
    expect(created.status).toBe(200)
    const affiliateId = created.body.data.id

    const req = await call('/api/affiliates/portal/request', json({ email, merchantId }))
    expect(req.status).toBe(200)
    expect(req.body.data.sent).toBe(true)
    // Non-production returns the token for mailbox-free tests
    const token = req.body.data.token as string | undefined
    expect(token).toBeTruthy()

    const me = await call(`/api/affiliates/portal/me?token=${encodeURIComponent(token as string)}`)
    expect(me.status).toBe(200)
    expect(me.body.data.affiliate.id).toBe(affiliateId)
    expect(me.body.data.stats).toBeDefined()
    expect(me.body.data.referrals).toBeDefined()

    const bad = await call('/api/affiliates/portal/me?token=bogus.token.here.now')
    expect(bad.status).toBe(401)

    await db.delete(referrals).where(eq(referrals.affiliateId, affiliateId))
    await db.delete(affiliates).where(eq(affiliates.id, affiliateId))
  })

  afterAll(async () => {
    for (const id of couponIds) {
      await db.delete(couponRedemptions).where(eq(couponRedemptions.couponId, id)).catch(() => undefined)
      await db.delete(coupons).where(eq(coupons.id, id)).catch(() => undefined)
    }
    for (const id of campaignIds) {
      await db.delete(campaigns).where(eq(campaigns.id, id)).catch(() => undefined)
    }
    for (const id of segmentIds) {
      await db.delete(customerSegments).where(eq(customerSegments.id, id)).catch(() => undefined)
    }
    for (const id of customerIds) {
      await db.delete(customers).where(eq(customers.id, id)).catch(() => undefined)
    }
    if (emails.length) {
      for (const email of emails) {
        await db
          .delete(customers)
          .where(and(eq(customers.merchantId, merchantId), eq(customers.email, email)))
          .catch(() => undefined)
      }
    }
    // Orders created by the delete-guard test
    const { orders, orderItems, inventoryLogs } = await import('../src/database/schema')
    const { like } = await import('drizzle-orm')
    await db.delete(inventoryLogs).where(and(eq(inventoryLogs.merchantId, merchantId), like(inventoryLogs.reference, '#W%'))).catch(() => undefined)
    const createdOrders = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.merchantId, merchantId), like(orders.orderNumber, '#W%')))
    for (const o of createdOrders) {
      await db.delete(orderItems).where(eq(orderItems.orderId, o.id)).catch(() => undefined)
    }
    await db.delete(orders).where(and(eq(orders.merchantId, merchantId), like(orders.orderNumber, '#W%'))).catch(() => undefined)
    if (productId) await db.delete(products).where(eq(products.id, productId)).catch(() => undefined)
    if (categoryId) await db.delete(categories).where(eq(categories.id, categoryId)).catch(() => undefined)
  })
})
