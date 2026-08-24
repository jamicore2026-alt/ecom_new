import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq, inArray, like } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { customers, inventoryLogs, merchants, orders, reviews } from '../src/database/schema'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const body = await res.json()
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

const REVIEWER = 'reviewer@example.com'
const PLAIN = 'plain@example.com'

describe('Product reviews', () => {
  let product: any
  let variantId: string
  let reviewerToken = ''
  let plainToken = ''
  let adminToken = ''
  let otherStoreId = ''

  beforeAll(async () => {
    const inserted = await db
      .insert(merchants)
      .values({ name: 'Other Store', slug: 'other-store', email: 'other@example.com' })
      .onConflictDoNothing()
      .returning({ id: merchants.id })
    otherStoreId = inserted[0]?.id ?? ''

    const login = await call('/api/auth/login', json({ email: 'admin@acme.com', password: 'password123' }))
    expect(login.status).toBe(200)
    adminToken = login.body.data.accessToken

    const list = await call('/api/store/acme-store/products?limit=100')
    product = list.body.data.items.find((i: any) => i.stock >= 20)
    const detail = await call(`/api/store/acme-store/products/${product.slug}`)
    variantId = detail.body.data.variants[0].id

    // Reviewer buys first so their review can be flagged as a verified purchase
    const placed = await call(
      '/api/store/acme-store/checkout',
      json({
        items: [{ productId: product.id, variantId, quantity: 1 }],
        email: REVIEWER,
        shippingAddress: { name: 'Rev Iewer', line1: '1 Star Rd', city: 'Dubai', state: 'DU', postalCode: '00000', country: 'AE' },
        paymentMethod: 'cod'
      })
    )
    expect(placed.status).toBe(200)
    const reviewerOrderNumber = placed.body.data.orderNumber

    for (const email of [REVIEWER, PLAIN]) {
      const reg = await call(
        '/api/store/acme-store/auth/register',
        json({
          email,
          password: 'sup3rsecret',
          firstName: email === PLAIN ? 'Plain' : 'Rev',
          lastName: 'Shopper',
          // Guest accounts require order-number proof to attach credentials.
          ...(email === REVIEWER ? { orderNumber: reviewerOrderNumber } : {})
        })
      )
      expect(reg.status).toBe(200)
    }
    const rLogin = await call('/api/store/acme-store/auth/login', json({ email: REVIEWER, password: 'sup3rsecret' }))
    const pLogin = await call('/api/store/acme-store/auth/login', json({ email: PLAIN, password: 'sup3rsecret' }))
    reviewerToken = rLogin.body.data.token
    plainToken = pLogin.body.data.token
  })

  it('lets a signed-in shopper submit a review that starts pending', async () => {
    const res = await call(
      '/api/store/acme-store/auth/reviews',
      json({ productId: product.id, rating: 5, title: 'Great buy', body: 'Exceeded expectations.' }, reviewerToken)
    )
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('pending')
  })

  it('upserts: a second submission replaces the first and returns to pending', async () => {
    await call(
      '/api/store/acme-store/auth/reviews',
      json({ productId: product.id, rating: 5, title: 'Great buy', body: 'v1' }, reviewerToken)
    )
    const res = await call(
      '/api/store/acme-store/auth/reviews',
      json({ productId: product.id, rating: 4, title: 'Still great', body: 'v2' }, reviewerToken)
    )
    expect(res.status).toBe(200)
    expect(res.body.data.rating).toBe(4)

    const listed = await call(`/api/reviews?productId=${product.id}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${adminToken}` }
    })
    expect(listed.status).toBe(200)
    expect(listed.body.data.meta.total).toBe(1)
    expect(listed.body.data.items[0].body).toBe('v2')

    // Second shopper (no purchase history) also reviews
    const plainRes = await call(
      '/api/store/acme-store/auth/reviews',
      json({ productId: product.id, rating: 5, title: 'Nice', body: 'Happy with it.' }, plainToken)
    )
    expect(plainRes.status).toBe(200)
  })

  it('hides unapproved reviews from the public PDP payload', async () => {
    const detail = await call(`/api/store/acme-store/products/${product.slug}`)
    expect(detail.body.data.rating).toBeNull()

    const list = await call(`/api/store/acme-store/products/${product.slug}/reviews`)
    expect(list.status).toBe(200)
    expect(list.body.data.items).toHaveLength(0)
  })

  it('rejects invalid ratings and non-shopper tokens', async () => {
    const badRating = await call(
      '/api/store/acme-store/auth/reviews',
      json({ productId: product.id, rating: 6 }, reviewerToken)
    )
    expect(badRating.status).toBeGreaterThanOrEqual(400)

    const noToken = await call(
      '/api/store/acme-store/auth/reviews',
      json({ productId: product.id, rating: 5 })
    )
    expect(noToken.status).toBe(401)

    const unknownProduct = await call(
      '/api/store/acme-store/auth/reviews',
      json({ productId: 'does-not-exist', rating: 5 }, reviewerToken)
    )
    expect(unknownProduct.status).toBe(404)
    expect(unknownProduct.body.error.code).toBe('PRODUCT_NOT_FOUND')
  })

  it('blocks cross-store review submissions', async () => {
    const res = await call(
      '/api/store/other-store/auth/reviews',
      json({ productId: product.id, rating: 5 }, reviewerToken)
    )
    expect(res.status).toBe(401)
  })

  it('merchant moderates: approve both reviews', async () => {
    const pending = await call('/api/reviews?status=pending&limit=100', {
      method: 'GET',
      headers: { authorization: `Bearer ${adminToken}` }
    })
    expect(pending.status).toBe(200)
    const mine = pending.body.data.items.filter((r: any) => r.productId === product.id)
    expect(mine.length).toBe(2)
    expect(mine[0].productName).toBe(product.name)

    for (const review of mine) {
      const res = await call(`/api/reviews/${review.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ status: 'approved' })
      })
      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('approved')
    }
  })

  it('public list shows approved reviews with correct verified flags', async () => {
    const list = await call(`/api/store/acme-store/products/${product.slug}/reviews`)
    expect(list.body.data.items).toHaveLength(2)
    const byAuthor = new Map<string, any>(list.body.data.items.map((r: any) => [r.authorName, r]))
    const verified = byAuthor.get('Rev Shopper')
    const plain = byAuthor.get('Plain Shopper')
    expect(verified?.verifiedPurchase).toBe(true)
    expect(plain?.verifiedPurchase).toBe(false)

    const detail = await call(`/api/store/acme-store/products/${product.slug}`)
    expect(detail.body.data.rating.count).toBe(2)
    expect(detail.body.data.rating.average).toBeCloseTo((5 + 4) / 2, 1)
  })

  it('re-submitting an approved review pulls it back into moderation', async () => {
    await call(
      '/api/store/acme-store/auth/reviews',
      json({ productId: product.id, rating: 3, title: 'Changed my mind', body: 'v3' }, reviewerToken)
    )

    const list = await call(`/api/store/acme-store/products/${product.slug}/reviews`)
    expect(list.body.data.items).toHaveLength(1)
    expect(list.body.data.items[0].authorName).toBe('Plain Shopper')

    const detail = await call(`/api/store/acme-store/products/${product.slug}`)
    expect(detail.body.data.rating.count).toBe(1)
  })

  it('deletes a review permanently', async () => {
    // approve the re-submitted review first, then delete it
    const pending = await call('/api/reviews?status=pending&limit=100', {
      method: 'GET',
      headers: { authorization: `Bearer ${adminToken}` }
    })
    const mine = pending.body.data.items.find((r: any) => r.productId === product.id && r.customerEmail === REVIEWER)
    expect(mine).toBeDefined()

    const del = await call(`/api/reviews/${mine.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${adminToken}` }
    })
    expect(del.status).toBe(200)
    expect(del.body.data.deleted).toBe(true)

    const after = await call('/api/reviews?productId=' + product.id, {
      method: 'GET',
      headers: { authorization: `Bearer ${adminToken}` }
    })
    expect(after.body.data.meta.total).toBe(1)
  })

  afterAll(async () => {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.slug, 'acme-store'))
    if (!merchant) return
    await db.delete(customers).where(and(eq(customers.merchantId, merchant.id), inArray(customers.email, [REVIEWER, PLAIN])))
    await db.delete(reviews).where(and(eq(reviews.merchantId, merchant.id), eq(reviews.productId, product.id)))
    await db.delete(inventoryLogs).where(and(eq(inventoryLogs.merchantId, merchant.id), like(inventoryLogs.reference, '#W%')))
    await db.delete(orders).where(and(eq(orders.merchantId, merchant.id), like(orders.orderNumber, '#W%')))
    if (otherStoreId) {
      await db.delete(merchants).where(eq(merchants.slug, 'other-store'))
    }
  })
})
