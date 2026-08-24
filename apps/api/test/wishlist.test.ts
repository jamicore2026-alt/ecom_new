import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { customers, merchants, products, wishlistItems } from '../src/database/schema'

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

const SHOPPER = 'wishful@example.com'

describe('Shopper wishlist', () => {
  let product: any
  let token = ''
  let adminToken = ''
  let otherStoreId = ''
  let draftProductId = ''

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

    const reg = await call(
      '/api/store/acme-store/auth/register',
      json({ email: SHOPPER, password: 'sup3rsecret', firstName: 'Wish', lastName: 'Ful' })
    )
    if (reg.status !== 200) throw new Error(`register failed: ${JSON.stringify(reg.body)}`)
    const lg = await call('/api/store/acme-store/auth/login', json({ email: SHOPPER, password: 'sup3rsecret' }))
    token = lg.body.data.token
  })

  it('requires a shopper session', async () => {
    const noToken = await call(
      '/api/store/acme-store/auth/wishlist',
      json({ productId: product.id })
    )
    expect(noToken.status).toBe(401)

    const emptyList = await call('/api/store/acme-store/auth/wishlist', {
      headers: { authorization: `Bearer ${token}` }
    })
    expect(emptyList.status).toBe(200)
    expect(emptyList.body.data.items).toHaveLength(0)
  })

  it('adds a product and returns card data', async () => {
    const res = await call('/api/store/acme-store/auth/wishlist', json({ productId: product.id }, token))
    expect(res.status).toBe(200)
    expect(res.body.data.saved).toBe(true)

    const list = await call('/api/store/acme-store/auth/wishlist', {
      headers: { authorization: `Bearer ${token}` }
    })
    expect(list.status).toBe(200)
    expect(list.body.data.items).toHaveLength(1)
    const item = list.body.data.items[0]
    expect(item.productId).toBe(product.id)
    expect(item.name).toBe(product.name)
    expect(item.slug).toBe(product.slug)
    expect(typeof item.price).toBe('number')
    expect(typeof item.stock).toBe('number')
    expect(typeof item.variantId).toBe('string')
  })

  it('is idempotent on duplicates', async () => {
    await call('/api/store/acme-store/auth/wishlist', json({ productId: product.id }, token))
    const list = await call('/api/store/acme-store/auth/wishlist', {
      headers: { authorization: `Bearer ${token}` }
    })
    expect(list.body.data.items).toHaveLength(1)
  })

  it('rejects unknown and non-active products', async () => {
    const missing = await call(
      '/api/store/acme-store/auth/wishlist',
      json({ productId: 'does-not-exist' }, token)
    )
    expect(missing.status).toBe(404)
    expect(missing.body.error.code).toBe('PRODUCT_NOT_FOUND')

    // A draft product is not wishlistable until the merchant activates it
    const created = await call(
      '/api/products',
      json({ name: 'Draft Wishlist Probe', price: 12.34, status: 'draft' }, adminToken)
    )
    expect(created.status).toBe(200)
    draftProductId = created.body.data.id
    expect(draftProductId).toBeTruthy()

    const draft = await call('/api/store/acme-store/auth/wishlist', json({ productId: draftProductId }, token))
    expect(draft.status).toBe(404)
    expect(draft.body.error.code).toBe('PRODUCT_NOT_FOUND')
  })

  it('blocks cross-store tokens', async () => {
    const res = await call(
      '/api/store/other-store/auth/wishlist',
      json({ productId: product.id }, token)
    )
    expect(res.status).toBe(401)
  })

  it('removes items and tolerates removing again', async () => {
    const del = await call(`/api/store/acme-store/auth/wishlist/${product.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` }
    })
    expect(del.status).toBe(200)
    expect(del.body.data.removed).toBe(true)

    const list = await call('/api/store/acme-store/auth/wishlist', {
      headers: { authorization: `Bearer ${token}` }
    })
    expect(list.body.data.items).toHaveLength(0)

    const again = await call(`/api/store/acme-store/auth/wishlist/${product.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` }
    })
    expect(again.status).toBe(200)
    expect(again.body.data.removed).toBe(false)
  })

  afterAll(async () => {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.slug, 'acme-store'))
    if (!merchant) return
    const [customer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.merchantId, merchant.id), eq(customers.email, SHOPPER)))
    if (customer) {
      await db.delete(wishlistItems).where(eq(wishlistItems.customerId, customer.id))
      await db.delete(customers).where(eq(customers.id, customer.id))
    }
    if (draftProductId) {
      await db.delete(products).where(inArray(products.id, [draftProductId]))
    }
    if (otherStoreId) {
      await db.delete(merchants).where(eq(merchants.slug, 'other-store'))
    }
  })
})
