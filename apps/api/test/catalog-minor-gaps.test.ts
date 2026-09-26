import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import {
  billOfMaterials,
  bomItems,
  categories,
  inventoryLogs,
  merchants,
  orderItems,
  orders,
  products,
  productVariants,
  productionOrderItems,
  productionOrders,
  stockTransfers,
  warehouseInventory,
  warehouses
} from '../src/database/schema'
import { setMailer } from '../src/shared/mailer'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}
const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const apiJson = (h: Record<string, string>, body: unknown) => ({ method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const apiPut = (h: Record<string, string>, body: unknown) => ({ method: 'PUT', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const apiDel = (h: Record<string, string>, path = '') => ({ method: 'DELETE', headers: h })
const apiGet = (h: Record<string, string>) => ({ method: 'GET', headers: h })
const auth = async (email = 'admin@jamicore.com') => {
  const res = await call('/api/auth/login', json({ email, password: 'password123' }))
  return { authorization: `Bearer ${res.body.data.accessToken}` }
}

const FIX = `MINORGAP-${Date.now()}`
let merchantId: string
let categoryId: string
const productIds: string[] = []
const variantIds: string[] = []
const bomIds: string[] = []
const batchIds: string[] = []
const whIds: string[] = []
const transferIds: string[] = []
const orderIds: string[] = []

const launchReadyBody = (over: Record<string, unknown> = {}) => ({
  name: `Minor Gap ${FIX}`,
  price: 25,
  description: 'A launch-ready test product',
  categoryId,
  images: [{ url: 'https://example.com/img.jpg' }],
  ...over
})

describe('Catalog + inventory minor gaps', () => {
  beforeAll(async () => {
    const [m] = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.slug, 'jamicore-store'))
    merchantId = m.id
    const h = await auth()
    const cat = (await call('/api/categories', apiJson(h, { name: `Minor Gap Cat ${FIX}` }))).body.data
    categoryId = cat.id
  })

  afterAll(async () => {
    setMailer(null)
    if (orderIds.length) {
      await db.delete(orderItems).where(inArray(orderItems.orderId, orderIds))
      await db.delete(orders).where(inArray(orders.id, orderIds))
    }
    if (transferIds.length) await db.delete(stockTransfers).where(inArray(stockTransfers.id, transferIds))
    if (batchIds.length) {
      await db.delete(productionOrderItems).where(inArray(productionOrderItems.productionOrderId, batchIds))
      await db.delete(productionOrders).where(inArray(productionOrders.id, batchIds))
    }
    if (bomIds.length) {
      await db.delete(bomItems).where(inArray(bomItems.bomId, bomIds))
      await db.delete(billOfMaterials).where(inArray(billOfMaterials.id, bomIds))
    }
    if (whIds.length) {
      await db.delete(warehouseInventory).where(inArray(warehouseInventory.warehouseId, whIds))
      await db.delete(warehouses).where(inArray(warehouses.id, whIds))
    }
    if (variantIds.length) {
      await db.delete(inventoryLogs).where(inArray(inventoryLogs.variantId, variantIds))
      await db.delete(productVariants).where(inArray(productVariants.id, variantIds))
    }
    if (productIds.length) await db.delete(products).where(inArray(products.id, productIds))
    await db.delete(categories).where(eq(categories.id, categoryId))
  })

  it('1. generateVariants dedupes duplicate option combos', async () => {
    const h = await auth()
    const p = (await call('/api/products', apiJson(h, launchReadyBody({ name: `Gen ${FIX}`, status: 'draft' })))).body.data
    productIds.push(p.id)
    // Duplicate option names produce identical combos — only one row per combo survives.
    await call(
      `/api/products/${p.id}/options`,
      { method: 'PUT', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({
        options: [
          { name: 'Size', values: [{ value: 'M' }] },
          { name: 'Size', values: [{ value: 'M' }] }
        ]
      }) }
    )
    const gen = await call(`/api/products/${p.id}/variants/generate`, apiJson(h, {}))
    expect(gen.status).toBe(200)
    expect(gen.body.data.created).toBe(1)
    const again = await call(`/api/products/${p.id}/variants/generate`, apiJson(h, {}))
    expect(again.body.data.created).toBe(0)
  })

  it('1b. duplicate variant SKUs are rejected', async () => {
    const h = await auth()
    const p = (await call('/api/products', apiJson(h, launchReadyBody({ name: `SKU ${FIX}`, status: 'draft' })))).body.data
    productIds.push(p.id)
    const v1 = (await call(`/api/products/${p.id}/variants`, apiJson(h, { sku: `${FIX}-DUP`, price: 10 }))).body.data
    variantIds.push(v1.id)
    const dup = await call(`/api/products/${p.id}/variants`, apiJson(h, { sku: `${FIX}-dup`, price: 10 }))
    expect(dup.status).toBe(400)
    const upd = await call(`/api/variants/${v1.id}`, apiPut(h, { price: 11 }))
    expect(upd.status).toBe(200)
  })

  it('2. variant prune blocks stock held, allows force; blocks last variant + open orders', async () => {
    const h = await auth()
    const p = (await call('/api/products', apiJson(h, launchReadyBody({ name: `Prune ${FIX}`, status: 'draft' })))).body.data
    productIds.push(p.id)
    const detail = (await call(`/api/products/${p.id}`, apiGet(h))).body.data
    const defaultVariant = detail.variants[0].id
    const stocked = (await call(`/api/products/${p.id}/variants`, apiJson(h, { sku: `${FIX}-STOCK`, price: 10, inventory: 5 }))).body.data
    variantIds.push(stocked.id)

    // Stock held → 400 without force.
    const blocked = await call(`/api/products/${p.id}/variants/${stocked.id}`, apiDel(h))
    expect(blocked.status).toBe(400)
    expect(blocked.body.error.code).toBe('VARIANT_HAS_STOCK')
    // Force → deleted.
    const forced = await call(`/api/products/${p.id}/variants/${stocked.id}?force=true`, apiDel(h))
    expect(forced.status).toBe(200)
    variantIds.splice(variantIds.indexOf(stocked.id), 1)

    // Last remaining variant cannot be pruned.
    const last = await call(`/api/products/${p.id}/variants/${defaultVariant}`, apiDel(h))
    expect(last.status).toBe(400)
    expect(last.body.error.code).toBe('LAST_VARIANT')

    // Open-order usage blocks even a zero-stock non-last variant.
    const extra = (await call(`/api/products/${p.id}/variants`, apiJson(h, { sku: `${FIX}-OPEN`, price: 10 }))).body.data
    variantIds.push(extra.id)
    const [order] = await db.insert(orders).values({ merchantId, orderNumber: `#T-${FIX}`, status: 'pending' }).returning()
    orderIds.push(order.id)
    await db.insert(orderItems).values({ orderId: order.id, productId: p.id, variantId: extra.id, name: 't', quantity: 1 })
    const inUse = await call(`/api/products/${p.id}/variants/${extra.id}`, apiDel(h))
    expect(inUse.status).toBe(400)
    expect(inUse.body.error.code).toBe('VARIANT_IN_OPEN_ORDERS')
  })

  it('3. launch gate blocks activation until checklist passes', async () => {
    const h = await auth()
    // Creation is ungated (may be born active or draft); the gate lives on
    // the status TRANSITION draft → active.
    const draft = (await call('/api/products', apiJson(h, { name: `Gate ${FIX}`, price: 10, status: 'draft' }))).body.data
    productIds.push(draft.id)

    // Readiness endpoint reports the gaps.
    const check = (await call(`/api/products/${draft.id}/readiness`, apiGet(h))).body.data
    expect(check.ready).toBe(false)
    expect(check.missing).toContain('description')

    // Transition draft → active still blocked.
    const blocked = await call(`/api/products/${draft.id}`, apiPut(h, { status: 'active' }))
    expect(blocked.status).toBe(400)

    // Complete the checklist → activation succeeds.
    await call(`/api/products/${draft.id}`, apiPut(h, { description: 'Now described', categoryId, images: [{ url: 'https://example.com/a.jpg' }] }))
    const go = await call(`/api/products/${draft.id}`, apiPut(h, { status: 'active' }))
    expect(go.status).toBe(200)
    expect(go.body.data.status).toBe('active')
  })

  it('4. export honors list filters', async () => {
    const h = await auth()
    const token = `EXPTOK-${FIX}`
    const p = (await call('/api/products', apiJson(h, launchReadyBody({ name: `${token} Widget` })))).body.data
    productIds.push(p.id)
    const filtered = await app.handle(
      new Request(`http://localhost/api/products/export?search=${token}`, { headers: h })
    )
    const csv = await filtered.text()
    expect(filtered.status).toBe(200)
    expect(csv).toContain(`${token} Widget`)
    const all = await app.handle(new Request('http://localhost/api/products/export', { headers: h }))
    const allCsv = await all.text()
    expect(allCsv).toContain(`${token} Widget`)
    // A filter matching nothing yields headers only.
    const none = await app.handle(
      new Request('http://localhost/api/products/export?search=NO-SUCH-PRODUCT-ZZZ', { headers: h })
    )
    expect((await none.text()).includes(`${token} Widget`)).toBe(false)
  })

  it('5. low-stock alert fires once per variant per day', async () => {
    const h = await auth()
    const sent: Array<{ to: string; subject: string }> = []
    setMailer({ send: async (input) => { sent.push({ to: input.to, subject: input.subject }); return { ok: true, id: 'test' } } })
    const p = (await call('/api/products', apiJson(h, launchReadyBody({ name: `Alert ${FIX}`, lowStockThreshold: 5 })))).body.data
    productIds.push(p.id)
    const detail = (await call(`/api/products/${p.id}`, apiGet(h))).body.data
    const vid = detail.variants[0].id
    variantIds.push(vid)
    await call(`/api/inventory/${vid}/adjust`, apiJson(h, { change: 10, reason: 'purchase' }))
    sent.length = 0
    // Decrement below the threshold → one email.
    const dec = await call(`/api/inventory/${vid}/adjust`, apiJson(h, { change: -7, reason: 'sale' }))
    expect(dec.status).toBe(200)
    expect(sent.length).toBe(1)
    expect(sent[0].to).toContain('@')
    const markers = await db.select().from(inventoryLogs).where(and(eq(inventoryLogs.variantId, vid), eq(inventoryLogs.reason, 'low_stock_alert')))
    expect(markers.length).toBe(1)
    // Second crossing same day → throttled.
    await call(`/api/inventory/${vid}/adjust`, apiJson(h, { change: -1, reason: 'sale' }))
    expect(sent.length).toBe(1)
    setMailer(null)
  })

  it('6. BOM revise copies to revision+1; completion applies scrap/yield', async () => {
    const h = await auth()
    const comp = (await call('/api/products', apiJson(h, launchReadyBody({ name: `Comp ${FIX}` })))).body.data
    const out = (await call('/api/products', apiJson(h, launchReadyBody({ name: `Out ${FIX}` })))).body.data
    productIds.push(comp.id, out.id)
    const compVid = (await call(`/api/products/${comp.id}`, apiGet(h))).body.data.variants[0].id
    const outVid = (await call(`/api/products/${out.id}`, apiGet(h))).body.data.variants[0].id
    variantIds.push(compVid, outVid)
    await call(`/api/inventory/${compVid}/adjust`, apiJson(h, { change: 100, reason: 'purchase' }))

    const bom = (await call('/api/boms', apiJson(h, {
      name: `Rev ${FIX}`, outputVariantId: outVid, items: [{ variantId: compVid, quantity: 2 }]
    }))).body.data
    bomIds.push(bom.id)
    expect(bom.revision ?? 1).toBe(1)

    const revCall = await call(`/api/boms/${bom.id}/revise`, apiJson(h, { scrapPercent: 50, yieldPercent: 50 }))
    expect(revCall.status).toBe(200)
    const rev = revCall.body.data
    bomIds.push(rev.id)
    expect(rev.revision).toBe(2)
    expect(rev.revisionOf).toBe(bom.id)
    // Items copied.
    const revDetail = (await call(`/api/boms/${rev.id}`, apiGet(h))).body.data
    expect(revDetail.items.length).toBe(1)
    expect(revDetail.items[0].quantity).toBe(2)

    await call(`/api/boms/${rev.id}`, apiPut(h, { status: 'active' }))
    const order = (await call('/api/production-orders', apiJson(h, { bomId: rev.id, quantity: 2 }))).body.data
    batchIds.push(order.id)
    const done = (await call(`/api/production-orders/${order.id}/complete`, apiJson(h, {}))).body.data
    // Base consumption 2×2=4, scrap 50% → ceil(6) = 6. Base output 1×2=2, yield 50% → floor(1) = 1.
    expect(done.outputQuantity).toBe(1)
    const [after] = await db.select({ inventory: productVariants.inventory }).from(productVariants).where(eq(productVariants.id, compVid))
    expect(after.inventory).toBe(100 - 6)
  })

  it('7. transfers carry reason/carrier/tracking', async () => {
    const h = await auth()
    const a = (await call('/api/warehouses', apiJson(h, { name: `T Src ${FIX}`, code: `TSRC${Date.now()}` }))).body.data
    const b = (await call('/api/warehouses', apiJson(h, { name: `T Dst ${FIX}`, code: `TDST${Date.now()}` }))).body.data
    whIds.push(a.id, b.id)
    const p = (await call('/api/products', apiJson(h, launchReadyBody({ name: `TProd ${FIX}` })))).body.data
    productIds.push(p.id)
    const vid = (await call(`/api/products/${p.id}`, apiGet(h))).body.data.variants[0].id
    variantIds.push(vid)
    await call(`/api/warehouses/${a.id}/inventory`, apiPut(h, { variantId: vid, quantity: 10 }))
    const created = (await call('/api/transfers', apiJson(h, {
      fromWarehouseId: a.id, toWarehouseId: b.id, variantId: vid, quantity: 3,
      reasonCode: 'rebalance', carrier: 'DHL', trackingNumber: 'AWB123'
    }))).body.data
    expect(created.transferred).toBe(true)
    const list = (await call('/api/transfers', apiGet(h))).body.data
    const row = list.items.find((t: { fromWarehouseId: string }) => t.fromWarehouseId === a.id)
    expect(row.reasonCode).toBe('rebalance')
    expect(row.carrier).toBe('DHL')
    expect(row.trackingNumber).toBe('AWB123')
    const one = (await call(`/api/transfers/${row.id}`, apiGet(h))).body.data
    expect(one.trackingNumber).toBe('AWB123')
    transferIds.push(...list.items.filter((t: { fromWarehouseId: string }) => t.fromWarehouseId === a.id).map((t: { id: string }) => t.id))
  })

  it('8. inventory valuation totals qty × product cost', async () => {
    const h = await auth()
    const res = (await call('/api/inventory/valuation', apiGet(h))).body.data
    expect(typeof res.totalValue).toBe('number')
    expect(res.skuCount).toBeGreaterThan(0)
    expect(res.items.length).toBe(res.skuCount)
    const recomputed = res.items.reduce((s: number, i: { lineValue: number }) => s + i.lineValue, 0)
    expect(Math.abs(recomputed - res.totalValue)).toBeLessThan(0.01)
  })
})
