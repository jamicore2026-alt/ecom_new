import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { like } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { products } from '../src/database/schema'
import { storage } from '../src/shared/storage'

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const body = await res.json().catch(() => null)
  return { status: res.status, headers: res.headers, body }
}

describe('product image uploads', () => {
  let auth: Record<string, string> = {}
  const storedKeys: string[] = []
  let productId = ''
  let productSlug = ''

  beforeAll(async () => {
    const login = await call('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@acme.com', password: 'password123' })
    })
    auth = { authorization: `Bearer ${login.body.data.accessToken}` }
  })

  afterAll(async () => {
    await Promise.all(storedKeys.map((k) => storage.remove(k)))
    if (productId) {
      await db.delete(products).where(like(products.id, productId))
    }
  })

  it('rejects uploads without a token', async () => {
    const res = await call('/api/uploads', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('uploads a png and serves it back publicly', async () => {
    const form = new FormData()
    form.append('files', new File([PNG_1PX], 'dot.png', { type: 'image/png' }))
    const res = await call('/api/uploads', { method: 'POST', headers: auth, body: form })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    const file = res.body.data[0]
    expect(file.url.startsWith('/uploads/')).toBe(true)
    storedKeys.push(file.key)

    const served = await app.handle(new Request(`http://localhost${file.url}`))
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/png')
  })

  it('rejects unsupported file types', async () => {
    const form = new FormData()
    form.append('files', new File(['not an image'], 'notes.txt', { type: 'text/plain' }))
    const res = await call('/api/uploads', { method: 'POST', headers: auth, body: form })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  it('creates a product with images and exposes them on create/get', async () => {
    const createRes = await call('/api/products', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Upload Test Product',
        price: 9.99,
        variants: [{ sku: 'UPTEST-1', inventory: 3 }],
        images: [
          { url: '/uploads/test/a.webp', altText: 'front' },
          { url: '/uploads/test/b.webp', altText: 'back' }
        ]
      })
    })
    expect(createRes.status).toBe(200)
    productId = createRes.body.data.id
    productSlug = createRes.body.data.slug
    expect(createRes.body.data.images).toHaveLength(2)
    expect(createRes.body.data.primaryImage).toBe('/uploads/test/a.webp')

    const getRes = await call(`/api/products/${productId}`, { headers: auth })
    expect(getRes.status).toBe(200)
    expect(getRes.body.data.images.map((i: { sortOrder: number }) => i.sortOrder)).toEqual([0, 1])
  })

  it('replaces the whole image set on update', async () => {
    const res = await call(`/api/products/${productId}`, {
      method: 'PUT',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        images: [{ url: '/uploads/test/c.webp', altText: 'only' }]
      })
    })
    expect(res.status).toBe(200)
    expect(res.body.data.images).toHaveLength(1)
    expect(res.body.data.images[0].url).toBe('/uploads/test/c.webp')
  })

  it('storefront listing uses the gallery primary image', async () => {
    const res = await call(
      `/api/store/acme-store/products?search=${encodeURIComponent('Upload Test Product')}&limit=5`
    )
    expect(res.status).toBe(200)
    const item = res.body.data.items.find((p: { id: string }) => p.id === productId)
    expect(item).toBeDefined()
    expect(item.image).toBe('/uploads/test/c.webp')
  })

  it('storefront product detail returns the gallery array', async () => {
    const res = await call(`/api/store/acme-store/products/${productSlug}`)
    expect(res.status).toBe(200)
    expect(res.body.data.images).toEqual(['/uploads/test/c.webp'])
    expect(res.body.data.image).toBe('/uploads/test/c.webp')
  })

  it('returns 404 for missing files', async () => {
    const served = await app.handle(new Request('http://localhost/uploads/nope/missing.png'))
    expect(served.status).toBe(404)
  })
})
