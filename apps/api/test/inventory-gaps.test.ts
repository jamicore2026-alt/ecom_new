import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import {
  goodsReceiptItems,
  goodsReceipts,
  inventoryLogs,
  merchants,
  products,
  productVariants,
  purchaseOrderItems,
  purchaseOrders,
  stocktakeItems,
  stocktakeSessions,
  stockTransfers,
  suppliers,
  warehouseInventory,
  warehouses
} from '../src/database/schema'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}
const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const apiJson = (h: Record<string, string>, body: unknown) => ({ method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const apiPut = (h: Record<string, string>, body: unknown) => ({ method: 'PUT', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const apiDel = (h: Record<string, string>) => ({ method: 'DELETE', headers: h })
const auth = async (email = 'admin@jamicore.com') => {
  const res = await call('/api/auth/login', json({ email, password: 'password123' }))
  return { authorization: `Bearer ${res.body.data.accessToken}` }
}

let merchantId: string
let variantId: string
let variantBaseline = 0
const whIds: string[] = []
const poIds: string[] = []
const supplierIds: string[] = []
const transferIds: string[] = []
const sessionIds: string[] = []

const stockOf = async (wid: string, vid: string) => {
  const [r] = await db.select({ q: warehouseInventory.quantity }).from(warehouseInventory).where(and(eq(warehouseInventory.warehouseId, wid), eq(warehouseInventory.variantId, vid)))
  return r?.q ?? 0
}
const globalOf = async (vid: string) => {
  const [r] = await db.select({ i: productVariants.inventory }).from(productVariants).where(eq(productVariants.id, vid))
  return r?.i ?? 0
}

describe('Inventory major gaps', () => {
  beforeAll(async () => {
    const [m] = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.slug, 'jamicore-store'))
    merchantId = m.id
    const seeded = await db
      .select({ id: productVariants.id, inventory: productVariants.inventory })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(and(eq(products.merchantId, merchantId), eq(products.status, 'active')))
    const pick = seeded.find((v) => v.inventory >= 30) ?? seeded[0]
    variantId = pick.id
    variantBaseline = pick.inventory
  })

  afterAll(async () => {
    await db.update(productVariants).set({ inventory: variantBaseline }).where(eq(productVariants.id, variantId))
    const rRows = await db.select({ id: goodsReceipts.id }).from(goodsReceipts).where(eq(goodsReceipts.merchantId, merchantId))
    const rIds = rRows.map((r) => r.id)
    if (rIds.length) {
      await db.delete(goodsReceiptItems).where(inArray(goodsReceiptItems.goodsReceiptId, rIds))
      await db.delete(goodsReceipts).where(inArray(goodsReceipts.id, rIds))
    }
    if (poIds.length) {
      await db.delete(purchaseOrderItems).where(inArray(purchaseOrderItems.purchaseOrderId, poIds))
      await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, poIds))
    }
    if (transferIds.length) await db.delete(stockTransfers).where(inArray(stockTransfers.id, transferIds))
    else await db.delete(stockTransfers).where(eq(stockTransfers.merchantId, merchantId))
    if (sessionIds.length) {
      await db.delete(stocktakeItems).where(inArray(stocktakeItems.sessionId, sessionIds))
      await db.delete(stocktakeSessions).where(inArray(stocktakeSessions.id, sessionIds))
    }
    if (whIds.length) {
      await db.delete(warehouseInventory).where(inArray(warehouseInventory.warehouseId, whIds))
      await db.delete(warehouses).where(inArray(warehouses.id, whIds))
    }
    if (supplierIds.length) await db.delete(suppliers).where(inArray(suppliers.id, Array.from(new Set(supplierIds))))
    await db.delete(inventoryLogs).where(and(eq(inventoryLogs.merchantId, merchantId), eq(inventoryLogs.variantId, variantId)))
  })

  it('1. create PO with unknown variant is rejected (validateItems awaited)', async () => {
    const h = await auth()
    const sup = (await call('/api/suppliers', apiJson(h, { name: 'Gap Supplier A' }))).body.data
    supplierIds.push(sup.id)
    const res = await call('/api/purchase-orders', apiJson(h, { supplierId: sup.id, items: [{ variantId: 'does-not-exist', quantity: 1, unitCost: 1 }] }))
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('VARIANT_NOT_FOUND')
  })

  it('2. setInventory writes an inventoryLogs row (reason adjustment)', async () => {
    const h = await auth()
    const wh = (await call('/api/warehouses', apiJson(h, { name: 'Gap Log Wh', code: 'GAPLOG' }))).body.data
    whIds.push(wh.id)
    const before = await stockOf(wh.id, variantId)
    const res = await call(`/api/warehouses/${wh.id}/inventory`, apiPut(h, { variantId, quantity: before + 7 }))
    expect(res.status).toBe(200)
    const logs = await db.select().from(inventoryLogs).where(and(eq(inventoryLogs.merchantId, merchantId), eq(inventoryLogs.variantId, variantId), eq(inventoryLogs.reason, 'adjustment'), eq(inventoryLogs.reference, wh.id)))
    const match = logs.find((l) => l.afterValue === before + 7 && l.beforeValue === before && l.change === 7)
    expect(match).toBeTruthy()
  })

  it('5. isDefault:false unsets the flag', async () => {
    const h = await auth()
    const wh = (await call('/api/warehouses', apiJson(h, { name: 'Gap Default', code: 'GAPDEF', isDefault: true }))).body.data
    whIds.push(wh.id)
    expect(wh.isDefault).toBe(true)
    const upd = await call(`/api/warehouses/${wh.id}`, apiPut(h, { name: wh.name, code: wh.code, isDefault: false }))
    expect(upd.status).toBe(200)
    expect(upd.body.data.isDefault).toBe(false)
  })

  it('3. deferred transfer creates in_transit without moving stock; receive completes it', async () => {
    const h = await auth()
    const a = (await call('/api/warehouses', apiJson(h, { name: 'Gap Src', code: 'GAPSRC' }))).body.data
    const b = (await call('/api/warehouses', apiJson(h, { name: 'Gap Dst', code: 'GAPDST' }))).body.data
    whIds.push(a.id, b.id)
    await call(`/api/warehouses/${a.id}/inventory`, apiPut(h, { variantId, quantity: 20 }))
    const beforeB = await stockOf(b.id, variantId)
    const created = await call('/api/transfers', apiJson(h, { fromWarehouseId: a.id, toWarehouseId: b.id, variantId, quantity: 6, deferred: true }))
    expect(created.status).toBe(200)
    expect(created.body.data.status).toBe('in_transit')
    const tid = created.body.data.id
    transferIds.push(tid)
    // No movement yet.
    expect(await stockOf(a.id, variantId)).toBe(20)
    expect(await stockOf(b.id, variantId)).toBe(beforeB)
    const recv = await call(`/api/transfers/${tid}/receive`, apiJson(h, {}))
    expect(recv.status).toBe(200)
    expect(await stockOf(a.id, variantId)).toBe(14)
    expect(await stockOf(b.id, variantId)).toBe(beforeB + 6)
    // Receiving again is a conflict.
    const again = await call(`/api/transfers/${tid}/receive`, apiJson(h, {}))
    expect(again.status).toBe(409)
    // Cancelling a completed transfer is a conflict.
    const cancelDone = await call(`/api/transfers/${tid}/cancel`, apiJson(h, {}))
    expect(cancelDone.status).toBe(409)
  })

  it('3b. cancel voids an in_transit transfer with no movement; reverse moves stock back', async () => {
    const h = await auth()
    const [aId, bId] = whIds.slice(-2)
    const aBefore = await stockOf(aId, variantId)
    const bBefore = await stockOf(bId, variantId)
    const created = await call('/api/transfers', apiJson(h, { fromWarehouseId: aId, toWarehouseId: bId, variantId, quantity: 2, deferred: true }))
    const tid = created.body.data.id
    transferIds.push(tid)
    const cancelled = await call(`/api/transfers/${tid}/cancel`, apiJson(h, {}))
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.data.status).toBe('cancelled')
    expect(await stockOf(aId, variantId)).toBe(aBefore)
    expect(await stockOf(bId, variantId)).toBe(bBefore)

    // Reverse the completed transfer from the previous test.
    const completedId = transferIds[0]
    const rev = await call(`/api/transfers/${completedId}/reverse`, apiJson(h, {}))
    expect(rev.status).toBe(200)
    expect(rev.body.data.status).toBe('reversed')
    expect(rev.body.data.reversalId).toBeTruthy()
    transferIds.push(rev.body.data.reversalId)
    expect(await stockOf(aId, variantId)).toBe(aBefore + 6)
    expect(await stockOf(bId, variantId)).toBe(bBefore - 6)
  })

  it('4. cancel blocked after receipt; return restores cancellability; multi-warehouse GR splits putaway', async () => {
    const h = await auth()
    const sup = (await call('/api/suppliers', apiJson(h, { name: 'Gap Supplier B' }))).body.data
    supplierIds.push(sup.id)
    const w1 = (await call('/api/warehouses', apiJson(h, { name: 'Gap W1', code: 'GAPW1' }))).body.data
    const w2 = (await call('/api/warehouses', apiJson(h, { name: 'Gap W2', code: 'GAPW2' }))).body.data
    whIds.push(w1.id, w2.id)
    const po = (await call('/api/purchase-orders', apiJson(h, { supplierId: sup.id, items: [{ variantId, quantity: 6, unitCost: 3 }] }))).body.data
    poIds.push(po.id)
    await call(`/api/purchase-orders/${po.id}/submit`, apiJson(h, {}))
    await call(`/api/purchase-orders/${po.id}/approve`, apiJson(h, {}))
    const detail = (await call(`/api/purchase-orders/${po.id}`, { headers: h })).body.data
    const gBefore = await globalOf(variantId)
    // Multi-warehouse: 4 units to w1, 2 units to w2 in ONE receipt.
    const recv = await call(
      `/api/purchase-orders/${po.id}/receive`,
      apiJson(h, {
        warehouseId: w1.id,
        items: [
          { purchaseOrderItemId: detail.items[0].id, quantity: 4, warehouseId: w1.id },
          { purchaseOrderItemId: detail.items[0].id, quantity: 2, warehouseId: w2.id }
        ]
      })
    )
    expect(recv.status).toBe(200)
    expect(recv.body.data.status).toBe('received')
    expect(await stockOf(w1.id, variantId)).toBe(4)
    expect(await stockOf(w2.id, variantId)).toBe(2)
    expect(await globalOf(variantId)).toBe(gBefore + 6)
    // Cancel is now blocked.
    const cancelBlocked = await call(`/api/purchase-orders/${po.id}/cancel`, apiJson(h, {}))
    expect(cancelBlocked.status).toBe(409)
    // Return 6 units (split back across both warehouses).
    const ret = await call(
      `/api/purchase-orders/${po.id}/return`,
      apiJson(h, {
        items: [
          { purchaseOrderItemId: detail.items[0].id, quantity: 4, warehouseId: w1.id },
          { purchaseOrderItemId: detail.items[0].id, quantity: 2, warehouseId: w2.id }
        ]
      })
    )
    expect(ret.status).toBe(200)
    expect(ret.body.data.receiptNumber.startsWith('#RTN')).toBe(true)
    expect(await stockOf(w1.id, variantId)).toBe(0)
    expect(await stockOf(w2.id, variantId)).toBe(0)
    expect(await globalOf(variantId)).toBe(gBefore)
    const retLog = await db.select().from(inventoryLogs).where(and(eq(inventoryLogs.merchantId, merchantId), eq(inventoryLogs.variantId, variantId), eq(inventoryLogs.reason, 'return')))
    expect(retLog.length).toBeGreaterThanOrEqual(1)
    // Net received is zero again → cancel succeeds.
    const cancelled = await call(`/api/purchase-orders/${po.id}/cancel`, apiJson(h, {}))
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.data.status).toBe('cancelled')
  })

  it('4b. supplier delete blocked with POs; PO delete draft-only', async () => {
    const h = await auth()
    const sup = (await call('/api/suppliers', apiJson(h, { name: 'Gap Supplier C' }))).body.data
    supplierIds.push(sup.id)
    const po = (await call('/api/purchase-orders', apiJson(h, { supplierId: sup.id, items: [{ variantId, quantity: 1, unitCost: 1 }] }))).body.data
    poIds.push(po.id)
    const delBlocked = await call(`/api/suppliers/${sup.id}`, apiDel(h))
    expect(delBlocked.status).toBe(409)
    // Draft PO can be deleted.
    const delPo = await call(`/api/purchase-orders/${po.id}`, apiDel(h))
    expect(delPo.status).toBe(200)
    poIds.splice(poIds.indexOf(po.id), 1)
    // Supplier with no POs can now be deleted.
    const delSup = await call(`/api/suppliers/${sup.id}`, apiDel(h))
    expect(delSup.status).toBe(200)
    supplierIds.splice(supplierIds.indexOf(sup.id), 1)
    // Non-draft PO cannot be deleted.
    const sup2 = (await call('/api/suppliers', apiJson(h, { name: 'Gap Supplier D' }))).body.data
    supplierIds.push(sup2.id)
    const po2 = (await call('/api/purchase-orders', apiJson(h, { supplierId: sup2.id, items: [{ variantId, quantity: 1, unitCost: 1 }] }))).body.data
    poIds.push(po2.id)
    await call(`/api/purchase-orders/${po2.id}/submit`, apiJson(h, {}))
    const delNonDraft = await call(`/api/purchase-orders/${po2.id}`, apiDel(h))
    expect(delNonDraft.status).toBe(409)
  })

  it('6. stocktake draft → submit → approve applies variance with logs (+ warehouse mirror)', async () => {
    const h = await auth()
    const wh = (await call('/api/warehouses', apiJson(h, { name: 'Gap Count Wh', code: 'GAPCNT' }))).body.data
    whIds.push(wh.id)
    await call(`/api/warehouses/${wh.id}/inventory`, apiPut(h, { variantId, quantity: 10 }))
    const gBefore = await globalOf(variantId)
    const sess = (await call('/api/stocktake/sessions', apiJson(h, { warehouseId: wh.id, notes: 'cycle count' }))).body.data
    expect(sess.status).toBe('draft')
    sessionIds.push(sess.id)
    const added = (await call(`/api/stocktake/sessions/${sess.id}/items`, apiJson(h, { variantId, countedQuantity: 13 }))).body.data
    expect(added.systemQuantity).toBe(10)
    expect(added.variance).toBe(3)
    const sub = await call(`/api/stocktake/sessions/${sess.id}/submit`, apiJson(h, {}))
    expect(sub.status).toBe(200)
    const appr = await call(`/api/stocktake/sessions/${sess.id}/approve`, apiJson(h, {}))
    expect(appr.status).toBe(200)
    expect(appr.body.data.status).toBe('approved')
    expect(await stockOf(wh.id, variantId)).toBe(13)
    expect(await globalOf(variantId)).toBe(gBefore + 3)
    const logs = await db.select().from(inventoryLogs).where(and(eq(inventoryLogs.merchantId, merchantId), eq(inventoryLogs.variantId, variantId), eq(inventoryLogs.reason, 'stocktake'), eq(inventoryLogs.reference, sess.id)))
    expect(logs.length).toBeGreaterThanOrEqual(1)
    expect(logs[0].change).toBe(3)
    // Approving again is a conflict.
    const again = await call(`/api/stocktake/sessions/${sess.id}/approve`, apiJson(h, {}))
    expect(again.status).toBe(409)
  })

  it('warehouses delete refuses non-empty locations', async () => {
    const h = await auth()
    const cntId = whIds[whIds.length - 1]
    const del = await call(`/api/warehouses/${cntId}`, apiDel(h))
    expect(del.status).toBe(400)
  })
})
