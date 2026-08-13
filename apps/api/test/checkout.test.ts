import { afterAll, describe, expect, it } from 'bun:test'
import { and, eq, inArray, like } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { coupons, customers, inventoryLogs, merchants, orders } from '../src/database/schema'

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

describe('Storefront checkout', () => {
  let product: any
  let variantId: string
  let lowStockProduct: any
  let lowStockVariantId: string

  it('fetches products to use for checkout', async () => {
    const list = await call('/api/store/acme-store/products?limit=100')
    const items = list.body.data.items
    product = items.find((i: any) => i.stock >= 20)
    expect(product).toBeDefined()
    const detail = await call(`/api/store/acme-store/products/${product.slug}`)
    expect(detail.status).toBe(200)
    variantId = detail.body.data.variants[0].id
    expect(variantId).toBeDefined()

    const low = items.find((i: any) => i.trackInventory && i.stock > 0 && i.stock < 10)
    expect(low).toBeDefined()
    lowStockProduct = low
    const lowDetail = await call(`/api/store/acme-store/products/${low.slug}`)
    lowStockVariantId = lowDetail.body.data.variants[0].id
  })

  it('previews a cart with validated line items and totals', async () => {
    const res = await call(
      '/api/store/acme-store/checkout/preview',
      json({ items: [{ productId: product.id, variantId, quantity: 2 }] })
    )
    expect(res.status).toBe(200)
    const data = res.body.data
    expect(data.items).toHaveLength(1)
    expect(data.items[0].name).toBe(product.name)
    expect(data.items[0].price).toBeNumber()
    expect(data.items[0].total).toBeCloseTo(data.items[0].price * 2)
    expect(data.subtotal).toBe(data.items[0].total)
    expect(data.shippingTotal).toBeNumber()
    expect(data.taxTotal).toBeGreaterThanOrEqual(0)
    expect(data.total).toBeCloseTo(data.subtotal + data.shippingTotal - data.discountTotal + data.taxTotal)
  })

  it('applies a valid coupon to the preview', async () => {
    const res = await call(
      '/api/store/acme-store/checkout/preview',
      json({ items: [{ productId: product.id, variantId, quantity: 2 }], couponCode: 'welcome15' })
    )
    expect(res.status).toBe(200)
    const data = res.body.data
    expect(data.coupon.code).toBe('WELCOME15')
    expect(data.discountTotal).toBeCloseTo(data.subtotal * 0.15)
    expect(data.total).toBeCloseTo(
      data.subtotal + data.shippingTotal + data.taxTotal - data.discountTotal
    )
  })

  it('rejects an unknown coupon', async () => {
    const res = await call(
      '/api/store/acme-store/checkout/preview',
      json({ items: [{ productId: product.id, variantId, quantity: 1 }], couponCode: 'NOPE' })
    )
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('rejects a cart over the available stock', async () => {
    const res = await call(
      '/api/store/acme-store/checkout/preview',
      json({ items: [{ productId: lowStockProduct.id, variantId: lowStockVariantId, quantity: lowStockProduct.stock + 1 }] })
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('OUT_OF_STOCK')
  })

  it('rejects a variant that does not belong to the product', async () => {
    const other = await call('/api/store/acme-store/products?limit=100')
    const otherProduct = other.body.data.items.find((i: any) => i.id !== product.id)
    const otherDetail = await call(`/api/store/acme-store/products/${otherProduct.slug}`)
    const foreignVariant = otherDetail.body.data.variants[0].id
    const res = await call(
      '/api/store/acme-store/checkout/preview',
      json({ items: [{ productId: product.id, variantId: foreignVariant, quantity: 1 }] })
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VARIANT_NOT_FOUND')
  })

  it('places an order and returns a confirmation', async () => {
    const res = await call(
      '/api/store/acme-store/checkout',
      json({
        items: [{ productId: product.id, variantId, quantity: 1 }],
        couponCode: 'WELCOME15',
        email: 'buyer@example.com',
        shippingAddress: { name: 'Test Buyer', line1: '1 Main St', city: 'New York', state: 'NY', postalCode: '10001', country: 'US' },
        paymentMethod: 'card',
        notes: 'Please leave at door'
      })
    )
    expect(res.status).toBe(200)
    const order = res.body.data
    expect(order.orderNumber).toMatch(/^#W/)
    expect(order.status).toBe('pending')
    expect(order.paymentStatus).toBe('paid')
    expect(order.total).toBeNumber()
    expect(order.email).toBe('buyer@example.com')
  })

  it('fetches an order by its order number', async () => {
    const placed = await call(
      '/api/store/acme-store/checkout',
      json({
        items: [{ productId: product.id, variantId, quantity: 1 }],
        email: 'confirm@example.com',
        shippingAddress: { name: 'Confirm Buyer', line1: '2 Oak St', city: 'Toronto', state: 'ON', postalCode: 'M5V', country: 'CA' },
        paymentMethod: 'cod'
      })
    )
    expect(placed.status).toBe(200)
    const orderNumber = placed.body.data.orderNumber

    const res = await call(`/api/store/acme-store/orders/${orderNumber}`)
    expect(res.status).toBe(200)
    expect(res.body.data.orderNumber).toBe(orderNumber)
    expect(res.body.data.items.length).toBe(1)
    expect(res.body.data.shippingAddress.country).toBe('CA')
  })

  it('returns 404 for an unknown order number', async () => {
    const res = await call('/api/store/acme-store/orders/does-not-exist')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('ORDER_NOT_FOUND')
  })

  afterAll(async () => {
    const [merchant] = await db
      .select()
      .from(merchants)
      .where(eq(merchants.slug, 'acme-store'))
    if (!merchant) return
    await db
      .delete(customers)
      .where(
        and(
          eq(customers.merchantId, merchant.id),
          inArray(customers.email, ['buyer@example.com', 'confirm@example.com'])
        )
      )
    await db
      .delete(orders)
      .where(and(eq(orders.merchantId, merchant.id), like(orders.orderNumber, '#W%')))
    await db
      .delete(inventoryLogs)
      .where(and(eq(inventoryLogs.merchantId, merchant.id), like(inventoryLogs.reference, '#W%')))
    await db
      .update(coupons)
      .set({ usedCount: 410 })
      .where(and(eq(coupons.merchantId, merchant.id), eq(coupons.code, 'WELCOME15')))
  })
})
