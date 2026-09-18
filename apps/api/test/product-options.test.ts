import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import {
  merchants,
  products,
  productOptions,
  productOptionValues,
  productVariants
} from '../src/database/schema'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text()
  return { status: res.status, body }
}

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
})

const apiJson = (headers: Record<string, string>, body: unknown) => ({
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify(body)
})

const auth = async () => {
  const res = await call('/api/auth/login', json({ email: 'admin@jamicore.com', password: 'password123' }))
  return { authorization: `Bearer ${res.body.data.accessToken}` }
}

const stamp = Date.now()
let productId: string
let productSlug: string
let foreignVariantId: string

describe('Product variation options — definitions, generated variants, unlimited stock', () => {
  beforeAll(async () => {
    const [merchant] = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.slug, 'jamicore-store'))
    const merchantId = merchant.id
    const headers = await auth()
    const created = await call(
      '/api/products',
      apiJson(headers, {
        name: `Options Fixture ${stamp}`,
        sku: `OPT-${stamp}`,
        price: 100,
        trackInventory: true,
        status: 'active',
        visibility: 'both'
      })
    )
    expect(created.status).toBe(200)
    productId = created.body.data.id
    productSlug = created.body.data.slug

    // Build a real second merchant so RLS genuinely isolates its rows.
    const [other] = await db
      .insert(merchants)
      .values({
        name: `Foreign ${stamp}`,
        slug: `foreign-${stamp}`,
        email: `foreign-${stamp}@example.com`,
        currency: 'USD',
        status: 'active'
      })
      .returning()
    const [fProduct] = await db
      .insert(products)
      .values({
        merchantId: other.id,
        name: 'Foreign Options',
        slug: `foreign-options-${stamp}`,
        price: 1,
        status: 'active'
      })
      .returning()
    const [fVariant] = await db
      .insert(productVariants)
      .values({ productId: fProduct.id, price: 1, inventory: 5 })
      .returning()
    foreignVariantId = fVariant.id
    void merchantId
  })

  afterAll(async () => {
    if (productId) {
      await db.delete(productVariants).where(eq(productVariants.productId, productId))
      await db.delete(productOptions).where(eq(productOptions.productId, productId))
      await db.delete(products).where(eq(products.id, productId))
    }
    if (foreignVariantId) {
      const rows = await db
        .select({ productId: productVariants.productId })
        .from(productVariants)
        .where(eq(productVariants.id, foreignVariantId))
      for (const r of rows) {
        await db.delete(productVariants).where(eq(productVariants.id, foreignVariantId))
        await db.delete(products).where(eq(products.id, r.productId))
        const [fProduct] = await db
          .select({ merchantId: products.merchantId })
          .from(products)
          .where(eq(products.id, r.productId))
        if (fProduct) await db.delete(merchants).where(eq(merchants.id, fProduct.merchantId))
      }
    }
  })

  it('PUT options replaces the full set and lists it back', async () => {
    const headers = await auth()
    const res = await call(
      `/api/products/${productId}/options`,
      {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          options: [
            {
              name: 'Size',
              nameAr: 'المقاس',
              type: 'radio',
              required: true,
              minSelections: 1,
              maxSelections: 1,
              values: [
                { value: 'S', valueAr: 'صغير', sortOrder: 0 },
                { value: 'M', valueAr: 'وسط', sortOrder: 1 },
                { value: 'L', valueAr: 'كبير', priceAdjustment: 5, sortOrder: 2 }
              ]
            },
            {
              name: 'Color',
              nameAr: 'اللون',
              type: 'radio',
              required: true,
              minSelections: 1,
              maxSelections: 1,
              perValueQuantity: true,
              values: [
                { value: 'Red', quantity: 4, sortOrder: 0 },
                { value: 'Blue', quantity: 9, sortOrder: 1 }
              ]
            }
          ]
        })
      }
    )
    expect(res.status).toBe(200)
    const { body } = res as unknown as {
      body: {
        success: boolean
        data: {
          items: Array<{
            name: string
            nameAr: string | null
            type: string
            required: boolean
            allowControl: { perValueQuantity: boolean }
            values: Array<{ value: string; valueAr: string | null; priceAdjustment?: number; quantity: number | null }>
          }>
        }
      }
    }
    expect(body.success).toBe(true)
    expect(body.data.items).toHaveLength(2)
    expect(body.data.items[0].name).toBe('Size')
    expect(body.data.items[0].nameAr).toBe('المقاس')
    expect(body.data.items[0].required).toBe(true)
    expect(body.data.items[0].values.map((v) => v.value)).toEqual(['S', 'M', 'L'])
    expect(body.data.items[0].values[2].priceAdjustment).toBe(5)
    expect(body.data.items[1].allowControl.perValueQuantity).toBe(true)
    expect(body.data.items[1].values[0].quantity).toBe(4)
    expect(body.data.items[1].values[1].quantity).toBe(9)
  })

  it('generate-variants builds the full cartesian matrix and is idempotent', async () => {
    const headers = await auth()
    const res = await call(`/api/products/${productId}/variants/generate`, { method: 'POST', headers })
    expect(res.status).toBe(200)
    const first = res.body.data as { items: Array<{ optionValues: Record<string, string> }>; created: number }
    // Size(3) × Color(2) = 6 combinations created; the auto-created default
    // (no-option) variant row stays untouched, so 7 rows total.
    expect(first.items).toHaveLength(7)
    expect(first.created).toBe(6)

    const again = await call(`/api/products/${productId}/variants/generate`, { method: 'POST', headers })
    expect(again.status).toBe(200)
    expect((again.body.data as { created: number }).created).toBe(0)
    expect((again.body.data as { items: unknown[] }).items).toHaveLength(7)
  })

  it('persists per-variant unlimited and persists it through update', async () => {
    const headers = await auth()
    const variants = await call(`/api/products/${productId}/variants`, { headers })
    expect(variants.status).toBe(200)
    const list = variants.body.data as Array<{ id: string; unlimited: boolean; price: number }>
    expect(list).toHaveLength(7)
    const target = list[0]

    const upd = await call(
      `/api/variants/${target.id}`,
      { method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ unlimited: true }) }
    )
    expect(upd.status).toBe(200)
    expect(upd.body.data.unlimited).toBe(true)

    // Keep existing values intact when only the flag flips.
    const upd2 = await call(
      `/api/variants/${target.id}`,
      { method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ price: 123.45 }) }
    )
    expect(upd2.status).toBe(200)
    expect(upd2.body.data.price).toBe(123.45)
    expect(upd2.body.data.unlimited).toBe(true)
  })

  it('storefront product exposes unlimited variants and option definitions', async () => {
    const [merchant] = await db.select({ slug: merchants.slug }).from(merchants).where(eq(merchants.slug, 'jamicore-store'))
    const slug = merchant.slug
    await db.update(products).set({ visibility: 'both' }).where(eq(products.id, productId))
    const res = await call(`/api/store/${slug}/products/${productSlug}`)
    expect(res.status).toBe(200)
    const body = res.body as unknown as {
      success?: boolean
      data: { options: Array<{ name: string; nameAr: string | null; values: Array<{ value: string }> }>; variants: Array<{ unlimited: boolean }> }
    }
    expect(body.data).toBeDefined()
    expect(body.data.options.length).toBe(2)
    expect(body.data.options[0].nameAr).toBe('المقاس')
    expect(body.data.variants.every((v) => typeof v.unlimited === 'boolean')).toBe(true)
  })
})