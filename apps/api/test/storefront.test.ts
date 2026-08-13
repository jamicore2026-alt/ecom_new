import { describe, expect, it } from 'bun:test'
import { app } from '../src/app'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const body = await res.json()
  return { status: res.status, body }
}

describe('Storefront public API (no auth)', () => {
  it('returns store identity for a seeded store', async () => {
    const res = await call('/api/store/acme-store/store')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.merchant.slug).toBe('acme-store')
    expect(res.body.data.settings.name).toBe('Acme Store')
    expect(res.body.data.shipping.freeShippingThreshold).toBeNumber()
  })

  it('returns 404 for an unknown store', async () => {
    const res = await call('/api/store/does-not-exist/store')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('STORE_NOT_FOUND')
  })

  it('returns the active category tree', async () => {
    const res = await call('/api/store/acme-store/categories')
    expect(res.status).toBe(200)
    expect(res.body.data.items.length).toBeGreaterThanOrEqual(8)
    const clothing = res.body.data.items.find((c: any) => c.slug === 'clothing')
    expect(clothing).toBeDefined()
    expect(clothing.children.length).toBe(2)
    expect(clothing.productCount).toBeNumber()
  })

  it('lists all active products with enriched fields', async () => {
    const res = await call('/api/store/acme-store/products')
    expect(res.status).toBe(200)
    expect(res.body.data.meta.total).toBe(20)
    const item = res.body.data.items[0]
    expect(item.price).toBeNumber()
    expect(item.stock).toBeNumber()
    expect(item.variantCount).toBeGreaterThan(0)
    expect(item).toHaveProperty('image')
    expect(item.category).toHaveProperty('slug')
  })

  it('filters products by category slug', async () => {
    const res = await call('/api/store/acme-store/products?category=clothing')
    expect(res.status).toBe(200)
    expect(res.body.data.meta.total).toBeGreaterThan(0)
    for (const item of res.body.data.items) {
      expect(['clothing', "men's-tops", "women's-dresses"]).toContain(item.category.slug)
    }
  })

  it('filters products by price range', async () => {
    const res = await call('/api/store/acme-store/products?minPrice=40&maxPrice=100')
    expect(res.status).toBe(200)
    expect(res.body.data.meta.total).toBeGreaterThan(0)
    for (const item of res.body.data.items) {
      expect(item.price).toBeGreaterThanOrEqual(40)
      expect(item.price).toBeLessThanOrEqual(100)
    }
  })

  it('sorts products by price ascending', async () => {
    const res = await call('/api/store/acme-store/products?sort=price_asc&limit=100')
    expect(res.status).toBe(200)
    const prices = res.body.data.items.map((i: any) => i.price)
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
  })

  it('returns 404 for an unknown category slug', async () => {
    const res = await call('/api/store/acme-store/products?category=nope')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND')
  })

  it('returns product detail with variants and related products', async () => {
    const res = await call('/api/store/acme-store/products/classic-cotton-tee')
    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('Classic Cotton Tee')
    expect(res.body.data.variants.length).toBe(3)
    expect(res.body.data.stock).toBeNumber()
    expect(res.body.data.category.name).toBe("Men's Tops")
    expect(Array.isArray(res.body.data.related)).toBe(true)
  })

  it('returns 404 for an unknown product slug', async () => {
    const res = await call('/api/store/acme-store/products/not-a-product')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('PRODUCT_NOT_FOUND')
  })

  it('searches products by name', async () => {
    const res = await call('/api/store/acme-store/search?search=dress')
    expect(res.status).toBe(200)
    expect(res.body.data.meta.total).toBeGreaterThan(0)
    for (const item of res.body.data.items) {
      expect(item.name.toLowerCase()).toContain('dress')
    }
  })

  it('paginates results', async () => {
    const page1 = await call('/api/store/acme-store/products?page=1&limit=5')
    const page2 = await call('/api/store/acme-store/products?page=2&limit=5')
    expect(page1.body.data.items).toHaveLength(5)
    expect(page2.body.data.items).toHaveLength(5)
    expect(page1.body.data.items[0].id).not.toBe(page2.body.data.items[0].id)
  })
})
