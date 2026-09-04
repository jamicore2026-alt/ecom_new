import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq, inArray, like } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { customers, inventoryLogs, merchants, orders } from '../src/database/schema'

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

const get = (path: string, token?: string): RequestInit => ({
  method: 'GET',
  headers: token ? { authorization: `Bearer ${token}` } : {}
})

const put = (body: unknown, token?: string): RequestInit => ({
  method: 'PUT',
  headers: {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {})
  },
  body: JSON.stringify(body)
})

const EMAIL = 'shopper@example.com'

describe('Storefront customer accounts', () => {
  let product: any
  let variantId: string
  let token = ''
  let orderNumber = ''

  beforeAll(async () => {
    // Second active store used to assert cross-store token isolation
    await db
      .insert(merchants)
      .values({
        name: 'Other Store',
        slug: 'other-store',
        email: 'other@example.com'
      })
      .onConflictDoNothing()

    const list = await call('/api/store/acme-store/products?limit=100')
    product = list.body.data.items.find((i: any) => i.stock >= 20)
    const detail = await call(`/api/store/acme-store/products/${product.slug}`)
    variantId = detail.body.data.variants[0].id
  })

  it('places a guest order that later attaches to the account', async () => {
    const res = await call(
      '/api/store/acme-store/checkout',
      json({
        items: [{ productId: product.id, variantId, quantity: 1 }],
        email: EMAIL,
        shippingAddress: { name: 'Shop Er', line1: '9 Elm St', city: 'Riyadh', state: 'RI', postalCode: '12345', country: 'SA' },
        paymentMethod: 'cod'
      })
    )
    expect(res.status).toBe(200)
    orderNumber = res.body.data.orderNumber
    expect(orderNumber).toMatch(/^#W/)
  })

  it('rejects credential attachment to a guest without order-number proof', async () => {
    const res = await call(
      '/api/store/acme-store/auth/register',
      json({ email: EMAIL, password: 'sup3rsecret', firstName: 'Shop', lastName: 'Er' })
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('CLAIM_ORDER_REQUIRED')
  })

  it('rejects credential attachment with a wrong order number', async () => {
    const res = await call(
      '/api/store/acme-store/auth/register',
      json({ email: EMAIL, password: 'sup3rsecret', orderNumber: '#WNOPE' })
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('CLAIM_ORDER_MISMATCH')
  })

  it('registers an account for the guest email (credentials attached)', async () => {
    const res = await call(
      '/api/store/acme-store/auth/register',
      json({
        email: EMAIL,
        password: 'sup3rsecret',
        firstName: 'Shop',
        lastName: 'Er',
        // Proof of mailbox ownership — cites the guest order just placed.
        orderNumber
      })
    )
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.token).toBeString()
    expect(res.body.data.customer.email).toBe(EMAIL)
    expect(res.body.data.customer.firstName).toBe('Shop')
    // credentials never leak
    expect(JSON.stringify(res.body.data)).not.toContain('passwordHash')
  })

  it('rejects duplicate registration with a conflict', async () => {
    const res = await call(
      '/api/store/acme-store/auth/register',
      json({ email: EMAIL.toUpperCase(), password: 'anotherpass1' })
    )
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('EMAIL_IN_USE')
  })

  it('rejects a wrong password', async () => {
    const res = await call('/api/store/acme-store/auth/login', json({ email: EMAIL, password: 'wrong-password' }))
    expect(res.status).toBe(401)
  })

  it('logs in and returns a session token', async () => {
    const res = await call('/api/store/acme-store/auth/login', json({ email: EMAIL.toUpperCase(), password: 'sup3rsecret' }))
    expect(res.status).toBe(200)
    token = res.body.data.token
    expect(token.split('.')).toHaveLength(3)
    expect(res.body.data.customer.ordersCount).toBeGreaterThanOrEqual(1)
  })

  it('returns the profile for a valid token', async () => {
    const res = await call('/api/store/acme-store/auth/me', get('/api/store/acme-store/auth/me', token))
    expect(res.status).toBe(200)
    expect(res.body.data.email).toBe(EMAIL)
    expect(res.body.data.lastName).toBe('Er')
  })

  it('exposes email-verification state on the profile', async () => {
    const res = await call('/api/store/acme-store/auth/me', get('/api/store/acme-store/auth/me', token))
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveProperty('emailVerified')
    expect(res.body.data.emailVerified).toBe(false)
  })

  it('updates the profile name and phone', async () => {
    const res = await call(
      '/api/store/acme-store/auth/me',
      put({ firstName: 'Renamed', lastName: '', phone: '+966500000000' }, token)
    )
    expect(res.status).toBe(200)
    expect(res.body.data.firstName).toBe('Renamed')
    expect(res.body.data.lastName).toBeNull()
    expect(res.body.data.phone).toBe('+966500000000')
  })

  it('requires a token to update the profile', async () => {
    const res = await call(
      '/api/store/acme-store/auth/me',
      put({ firstName: 'Hacker' })
    )
    expect(res.status).toBe(401)
  })

  it('lists only this customer\'s orders with line items', async () => {
    const res = await call('/api/store/acme-store/auth/orders', get('/api/store/acme-store/auth/orders', token))
    expect(res.status).toBe(200)
    const data = res.body.data
    expect(data.meta.total).toBeGreaterThanOrEqual(1)
    const mine = data.items.find((o: any) => o.orderNumber === orderNumber)
    expect(mine).toBeDefined()
    expect(mine.items).toHaveLength(1)
    expect(mine.items[0].name).toBe(product.name)
    expect(mine.itemCount).toBe(1)
    expect(mine.total).toBeNumber()
  })

  it('rejects missing or invalid tokens on guarded routes', async () => {
    const noToken = await call('/api/store/acme-store/auth/me', get('/api/store/acme-store/auth/me'))
    expect(noToken.status).toBe(401)

    const badToken = await call(
      '/api/store/acme-store/auth/me',
      get('/api/store/acme-store/auth/me', 'not.a.jwt')
    )
    expect(badToken.status).toBe(401)
  })

  it('refuses a token from another store', async () => {
    const res = await call('/api/store/other-store/auth/me', get('/api/store/other-store/auth/me', token))
    expect(res.status).toBe(401)
  })

  it('404s auth routes for unknown stores', async () => {
    const res = await call('/api/store/nope-store/auth/login', json({ email: EMAIL, password: 'sup3rsecret' }))
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('STORE_NOT_FOUND')
  })

  afterAll(async () => {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.slug, 'acme-store'))
    if (!merchant) return
    await db.delete(customers).where(and(eq(customers.merchantId, merchant.id), inArray(customers.email, [EMAIL])))
    await db.delete(inventoryLogs).where(and(eq(inventoryLogs.merchantId, merchant.id), like(inventoryLogs.reference, '#W%')))
    await db.delete(orders).where(and(eq(orders.merchantId, merchant.id), like(orders.orderNumber, '#W%')))
    await db.delete(merchants).where(eq(merchants.slug, 'other-store'))
  })
})
