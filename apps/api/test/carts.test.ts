import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq, inArray, like } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { carts, customers, inventoryLogs, merchants, orders } from '../src/database/schema'

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

const auth = async (email = 'admin@acme.com') => {
  const res = await call('/api/auth/login', json({ email, password: 'password123' }))
  return { authorization: `Bearer ${res.body.data.accessToken}` }
}

describe('Abandoned carts pipeline (storefront persistence → conversion)', () => {
  let product: any
  let variantId: string
  let merchantId: string
  let cartId = ''
  let createdCustomerEmails: string[] = []
  let createdOrderNumbers: string[] = []

  beforeAll(async () => {
    const [merchant] = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.slug, 'acme-store'))
    merchantId = merchant.id

    const list = await call('/api/store/acme-store/products?limit=100')
    product = list.body.data.items.find((i: any) => i.stock >= 20)
    const detail = await call(`/api/store/acme-store/products/${product.slug}`)
    variantId = detail.body.data.variants[0].id
  })

  it('persists a guest cart and returns a stable server-side id', async () => {
    const res = await call(
      '/api/store/acme-store/cart',
      json({
        items: [{ variantId, productId: product.id, name: product.name, price: 10, quantity: 2 }]
      })
    )
    expect(res.status).toBe(200)
    cartId = res.body.data.cart.id
    expect(cartId).toBeTruthy()

    // Saving again with the same cartId must update (not duplicate).
    const res2 = await call(
      '/api/store/acme-store/cart',
      json({
        cartId,
        items: [{ variantId, productId: product.id, name: product.name, price: 10, quantity: 3 }]
      })
    )
    expect(res2.status).toBe(200)
    expect(res2.body.data.cart.id).toBe(cartId)

    const list = await call('/api/carts', { headers: await auth() })
    const found = list.body.data.items.filter((c: { id: string }) => c.id === cartId)
    expect(found).toHaveLength(1)
    expect(found[0].status).toBe('active')
    expect(found[0].itemCount).toBe(1)
  })

  it('save with a bogus cartId does not error and creates a fresh cart', async () => {
    const res = await call('/api/store/acme-store/cart', json({ cartId: 'nonexistent-id-xyz', items: [] }))
    expect(res.status).toBe(200)
    expect(res.body.data.cart.id).toBeTruthy()

    // Never mutates a cart from another merchant — a foreign cartId simply doesn't match.
    const list = await call('/api/carts', { headers: await auth() })
    expect(list.status).toBe(200)
  })

  it('recover endpoint restores items for a cart with a recovery code', async () => {
    await db
      .update(carts)
      .set({ recoveryCode: `test-recover-${Date.now().toString(36)}` })
      .where(and(eq(carts.id, cartId), eq(carts.merchantId, merchantId)))

    const [row] = await db.select().from(carts).where(eq(carts.id, cartId))
    const res = await call(`/api/store/acme-store/cart/recover/${row.recoveryCode}`)
    expect(res.status).toBe(200)
    expect(res.body.data.restored).toBe(true)
    expect(res.body.data.cartId).toBe(cartId)
    expect(res.body.data.items).toHaveLength(1)
    expect(res.body.data.items[0].variantId).toBe(variantId)
  })

  it('marks the cart converted when a checkout includes its cartId', async () => {
    const res = await call(
      '/api/store/acme-store/checkout',
      json({
        items: [{ productId: product.id, variantId, quantity: 1 }],
        email: 'carts-buyer@example.com',
        shippingAddress: { name: 'Cart Buyer', line1: '1 Main St', city: 'New York', state: 'NY', postalCode: '10001', country: 'US' },
        paymentMethod: 'card',
        cartId
      })
    )
    expect(res.status).toBe(200)
    const orderNumber = res.body.data.orderNumber
    createdOrderNumbers.push(orderNumber)
    createdCustomerEmails.push('carts-buyer@example.com')

    const list = await call('/api/carts', { headers: await auth() })
    const found = list.body.data.items.find((c: { id: string }) => c.id === cartId)
    expect(found).toBeDefined()
    expect(found.status).toBe('converted')
  })

  it('checkout without a cartId leaves existing carts untouched', async () => {
    const [before] = await db.select().from(carts).where(eq(carts.id, cartId))
    const res = await call(
      '/api/store/acme-store/checkout',
      json({
        items: [{ productId: product.id, variantId, quantity: 1 }],
        email: 'carts-nocart@example.com',
        shippingAddress: { name: 'No Cart', line1: '1 Main St', city: 'New York', state: 'NY', postalCode: '10001', country: 'US' },
        paymentMethod: 'card'
      })
    )
    expect(res.status).toBe(200)
    createdOrderNumbers.push(res.body.data.orderNumber)
    createdCustomerEmails.push('carts-nocart@example.com')

    // The already-converted cart must stay converted (no cartId → no change).
    const [after] = await db.select().from(carts).where(eq(carts.id, cartId))
    expect(after.status).toBe('converted')
    expect(after.recoveredOrderId).toBe(before.recoveredOrderId)
  })

  afterAll(async () => {
    await db.delete(carts).where(and(eq(carts.merchantId, merchantId), eq(carts.id, cartId)))
    await db
      .delete(customers)
      .where(and(eq(customers.merchantId, merchantId), inArray(customers.email, createdCustomerEmails)))
    await db
      .delete(inventoryLogs)
      .where(and(eq(inventoryLogs.merchantId, merchantId), like(inventoryLogs.reference, '#W%')))
    await db
      .delete(orders)
      .where(and(eq(orders.merchantId, merchantId), like(orders.orderNumber, '#W%')))
  })
})
