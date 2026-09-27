import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { merchants, products } from '../src/database/schema'

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

const stamp = Date.now()
let adminToken = ''
let merchantId = ''
let productId = ''

describe('Variant definition fields (3-screen variant UX)', () => {
  beforeAll(async () => {
    const login = await call('/api/auth/login', json({ email: 'admin@jamicore.com', password: 'password123' }))
    adminToken = login.body.data.accessToken
    const [merchant] = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.slug, 'jamicore-store'))
    merchantId = merchant.id

    const prod = await call(
      '/api/products',
      json({ sku: `VDEF-${stamp}`, name: 'Variant Def Item', price: 10, status: 'active' }, adminToken)
    )
    expect(prod.status).toBe(200)
    productId = prod.body.data.id
  })

  afterAll(async () => {
    if (productId) await db.delete(products).where(and(eq(products.id, productId), eq(products.merchantId, merchantId))).catch(() => null)
  })

  const auth = () => ({ authorization: `Bearer ${adminToken}` })

  it('creates a variant with name, required, bounds and button style', async () => {
    const res = await call(
      `/api/products/${productId}/variants`,
      json(
        {
          optionValues: { Size: 'L' },
          optionValuesAr: { Size: 'كبير' },
          name: 'Large',
          nameAr: 'كبير',
          required: true,
          minSelections: 1,
          maxSelections: 2,
          buttonStyle: 'checkbox'
        },
        adminToken
      )
    )
    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('Large')
    expect(res.body.data.nameAr).toBe('كبير')
    expect(res.body.data.required).toBe(true)
    expect(res.body.data.minSelections).toBe(1)
    expect(res.body.data.maxSelections).toBe(2)
    expect(res.body.data.buttonStyle).toBe('checkbox')
    // Pricing/stock still default from the product (fields live elsewhere now)
    expect(Number(res.body.data.price)).toBe(10)
    expect(res.body.data.inventory).toBe(0)
  })

  it('rejects min greater than max', async () => {
    const res = await call(
      `/api/products/${productId}/variants`,
      json({ optionValues: { Size: 'M' }, minSelections: 3, maxSelections: 1 }, adminToken)
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_SELECTION_RANGE')
  })

  it('blank min/max round-trips as unlimited (null)', async () => {
    const created = await call(
      `/api/products/${productId}/variants`,
      json({ optionValues: { Size: 'S' }, buttonStyle: 'radio' }, adminToken)
    )
    expect(created.status).toBe(200)
    expect(created.body.data.minSelections).toBeNull()
    expect(created.body.data.maxSelections).toBeNull()

    const updated = await call(`/api/variants/${created.body.data.id}`, {
      method: 'PUT',
      headers: { ...auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ required: true, maxSelections: 1 })
    })
    expect(updated.status).toBe(200)
    expect(updated.body.data.required).toBe(true)
    expect(updated.body.data.maxSelections).toBe(1)
  })
})
