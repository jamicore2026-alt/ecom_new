import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { inArray } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { categories, products } from '../src/database/schema'
import { effectivePrice, isPublished } from '../src/modules/products/service'

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

const FIX = `CATGAP-${Date.now()}`

describe('Catalog gaps — sale window, publish scheduling, merchandising fields', () => {
  let adminToken = ''
  const createdIds: string[] = []
  const createdCatIds: string[] = []
  let productId = ''

  beforeAll(async () => {
    const login = await call('/api/auth/login', json({ email: 'admin@jamicore.com', password: 'password123' }))
    adminToken = login.body.data.accessToken
  })

  it('effectivePrice honors the sale window', () => {
    const now = new Date('2026-06-15T12:00:00Z')
    const row = {
      price: 20,
      compareAtPrice: 30,
      saleStartsAt: new Date('2026-06-01T00:00:00Z'),
      saleEndsAt: new Date('2026-06-30T00:00:00Z')
    }
    expect(effectivePrice(row, now)).toBe(20)
    // before the window → regular (compare-at) price
    expect(effectivePrice(row, new Date('2026-05-01T00:00:00Z'))).toBe(30)
    // after the window → regular price
    expect(effectivePrice(row, new Date('2026-07-01T00:00:00Z'))).toBe(30)
    // open bounds
    expect(effectivePrice({ price: 20, compareAtPrice: 30 }, now)).toBe(20)
    expect(
      effectivePrice({ price: 20, compareAtPrice: 30, saleEndsAt: new Date('2026-07-01T00:00:00Z') }, now)
    ).toBe(20)
    // no sale configured → stored price
    expect(effectivePrice({ price: 20 }, now)).toBe(20)
    expect(effectivePrice({ price: 20, compareAtPrice: null }, now)).toBe(20)
  })

  it('isPublished gates future publishAt and non-active status', () => {
    const now = new Date('2026-06-15T12:00:00Z')
    expect(isPublished({ status: 'active', publishAt: null }, now)).toBe(true)
    expect(isPublished({ status: 'active' }, now)).toBe(true)
    expect(isPublished({ status: 'draft', publishAt: null }, now)).toBe(false)
    expect(isPublished({ status: 'active', publishAt: new Date('2026-07-01T00:00:00Z') }, now)).toBe(false)
    expect(isPublished({ status: 'active', publishAt: new Date('2026-05-01T00:00:00Z') }, now)).toBe(true)
  })

  it('creates a product with tags/weight/gtin/meta/sale-dates/publishAt', async () => {
    const res = await call(
      '/api/products',
      json(
        {
          sku: `${FIX}-A`,
          name: 'Catalog Gap Alpha',
          price: 20,
          compareAtPrice: 30,
          tags: ['summer', 'cotton'],
          weight: 0.25,
          gtin: '6281000000099',
          metaTitle: 'Alpha SEO Title',
          metaDescription: 'Alpha SEO description.',
          saleStartsAt: '2026-06-01T00:00:00.000Z',
          saleEndsAt: '2026-06-30T00:00:00.000Z',
          publishAt: '2026-05-01T00:00:00.000Z'
        },
        adminToken
      )
    )
    expect(res.status).toBe(200)
    productId = res.body.data.id
    createdIds.push(productId)
    expect(res.body.data.tags).toEqual(['summer', 'cotton'])
    expect(Number(res.body.data.weight)).toBe(0.25)
    expect(res.body.data.gtin).toBe('6281000000099')
    expect(res.body.data.metaTitle).toBe('Alpha SEO Title')
    expect(res.body.data.metaDescription).toBe('Alpha SEO description.')
    expect(res.body.data.saleStartsAt).toBeTruthy()
    expect(res.body.data.publishAt).toBeTruthy()
  })

  it('updates the new fields and clears dates with null', async () => {
    const res = await call(
      `/api/products/${productId}`,
      put(
        {
          tags: ['winter'],
          weight: 0.5,
          gtin: null,
          metaTitle: 'Alpha SEO v2',
          metaDescription: null,
          saleStartsAt: null,
          saleEndsAt: null,
          publishAt: null
        },
        adminToken
      )
    )
    expect(res.status).toBe(200)
    expect(res.body.data.tags).toEqual(['winter'])
    expect(Number(res.body.data.weight)).toBe(0.5)
    expect(res.body.data.gtin).toBeNull()
    expect(res.body.data.metaTitle).toBe('Alpha SEO v2')
    expect(res.body.data.saleStartsAt).toBeNull()

    const detail = await call(`/api/products/${productId}`, {
      headers: { authorization: `Bearer ${adminToken}` }
    })
    expect(detail.body.data.tags).toEqual(['winter'])
    expect(detail.body.data.metaTitle).toBe('Alpha SEO v2')
  })

  it('bulk-edits visibility / compare-at / clear_sale', async () => {
    const auth = { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' } as Record<string, string>

    let res = await call(
      '/api/products/bulk',
      { method: 'POST', headers: auth, body: JSON.stringify({ ids: [productId], action: 'set_visibility', value: 'website' }) }
    )
    expect(res.status).toBe(200)

    res = await call(
      '/api/products/bulk',
      { method: 'POST', headers: auth, body: JSON.stringify({ ids: [productId], action: 'set_compare_at', value: 49.99 }) }
    )
    expect(res.status).toBe(200)
    let detail = await call(`/api/products/${productId}`, { headers: { authorization: `Bearer ${adminToken}` } })
    expect(detail.body.data.visibility).toBe('website')
    expect(Number(detail.body.data.compareAtPrice)).toBe(49.99)

    // invalid visibility is rejected
    res = await call(
      '/api/products/bulk',
      { method: 'POST', headers: auth, body: JSON.stringify({ ids: [productId], action: 'set_visibility', value: 'everywhere' }) }
    )
    expect(res.status).toBe(400)

    res = await call(
      '/api/products/bulk',
      { method: 'POST', headers: auth, body: JSON.stringify({ ids: [productId], action: 'clear_sale', value: null }) }
    )
    expect(res.status).toBe(200)
    detail = await call(`/api/products/${productId}`, { headers: { authorization: `Bearer ${adminToken}` } })
    expect(detail.body.data.compareAtPrice).toBeNull()
    expect(detail.body.data.saleStartsAt).toBeNull()
    expect(detail.body.data.saleEndsAt).toBeNull()
  })

  it('stores category description and reassigns products on delete', async () => {
    const auth = { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' } as Record<string, string>

    const a = await call(
      '/api/categories',
      { method: 'POST', headers: auth, body: JSON.stringify({ name: `Gap Cat A ${FIX}`, description: 'Category A description', slug: `gap-cat-a-${FIX}`.toLowerCase() }) }
    )
    expect(a.status).toBe(200)
    expect(a.body.data.description).toBe('Category A description')
    const catA = a.body.data.id
    createdCatIds.push(catA)

    const b = await call(
      '/api/categories',
      { method: 'POST', headers: auth, body: JSON.stringify({ name: `Gap Cat B ${FIX}`, slug: `gap-cat-b-${FIX}`.toLowerCase() }) }
    )
    expect(b.status).toBe(200)
    const catB = b.body.data.id
    createdCatIds.push(catB)

    // description persists through update
    const upd = await call(
      `/api/categories/${catA}`,
      { method: 'PUT', headers: auth, body: JSON.stringify({ name: a.body.data.name, description: 'Updated description' }) }
    )
    expect(upd.status).toBe(200)
    expect(upd.body.data.description).toBe('Updated description')

    // assign the product, then delete with reassignment
    await call(`/api/products/${productId}`, put({ categoryId: catA }, adminToken))
    const del = await call(`/api/categories/${catA}?reassignTo=${catB}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${adminToken}` }
    })
    expect(del.status).toBe(200)
    expect(del.body.data.reassignedTo).toBe(catB)
    createdCatIds.splice(createdCatIds.indexOf(catA), 1)

    const detail = await call(`/api/products/${productId}`, {
      headers: { authorization: `Bearer ${adminToken}` }
    })
    expect(detail.body.data.categoryId).toBe(catB)
  })

  it('filters by min/max price and low stock', async () => {
    const res = await call(`/api/products?minPrice=15&maxPrice=25`, {
      headers: { authorization: `Bearer ${adminToken}` }
    })
    expect(res.status).toBe(200)
    expect(res.body.data.items.every((p: { price: number }) => p.price >= 15 && p.price <= 25)).toBe(true)

    const low = await call(`/api/products?lowStock=true`, {
      headers: { authorization: `Bearer ${adminToken}` }
    })
    expect(low.status).toBe(200)
  })

  afterAll(async () => {
    if (createdIds.length) await db.delete(products).where(inArray(products.id, createdIds))
    if (createdCatIds.length) await db.delete(categories).where(inArray(categories.id, createdCatIds))
  })
})
