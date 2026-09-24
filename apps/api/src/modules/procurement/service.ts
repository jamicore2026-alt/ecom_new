import { and, count, desc, eq, sql } from 'drizzle-orm'
import type { DB } from '../../database/client'
import {
  goodsReceipts,
  goodsReceiptItems,
  productVariants,
  products,
  purchaseOrderItems,
  purchaseOrders,
  suppliers,
  warehouseInventory,
  warehouses
} from '../../database/schema'
import { makeMeta, parsePagination } from '../../shared/pagination'
import { ok } from '../../shared/response'
import { badRequest, conflict, notFound } from '../../shared/errors'
import { setVariantInventoryTx } from '../../shared/inventory'
import { emit } from '../../shared/event-dispatch'

const PO_STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ['pending', 'cancelled'],
  pending: ['approved', 'cancelled'],
  approved: ['partial', 'received', 'cancelled'],
  partial: ['received', 'cancelled'],
  received: [],
  cancelled: []
}

const nextNumber = (prefix: string) =>
  `${prefix}${Date.now().toString(36).toUpperCase()}${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0]

const assertPoInMerchant = async (db: DB, merchantId: string, poId: string) => {
  const [row] = await db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.merchantId, merchantId)))
  if (!row) throw notFound('PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found')
  return row
}

export class ProcurementService {
  /* --------------------------------- suppliers -------------------------------- */

  static async listSuppliers(db: DB, merchantId: string, q: { page?: string; limit?: string; search?: string; status?: string }) {
    const { page, limit, offset } = parsePagination(q)
    const conditions = [eq(suppliers.merchantId, merchantId)]
    if (q.search) {
      const s = `%${q.search.trim()}%`
      conditions.push(sql`(${suppliers.name} ilike ${s} or ${suppliers.email} ilike ${s})`)
    }
    if (q.status) conditions.push(eq(suppliers.status, q.status))

    const where = and(...conditions)
    const [{ total }] = await db
      .select({ total: count() })
      .from(suppliers)
      .where(where)

    const rows = await db
      .select()
      .from(suppliers)
      .where(where)
      .orderBy(desc(suppliers.createdAt))
      .limit(limit)
      .offset(offset)

    return ok({ items: rows, meta: makeMeta(page, limit, Number(total)) })
  }

  static async getSupplier(db: DB, merchantId: string, id: string) {
    const [row] = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, id), eq(suppliers.merchantId, merchantId)))
    if (!row) throw notFound('SUPPLIER_NOT_FOUND', 'Supplier not found')
    return ok(row)
  }

  static async createSupplier(
    db: DB,
    merchantId: string,
    input: {
      name: string
      contactName?: string
      email?: string
      phone?: string
      address?: Record<string, unknown>
      taxId?: string
      notes?: string
    }
  ) {
    if (!input.name.trim()) throw badRequest('INVALID_NAME', 'Supplier name is required')
    const [row] = await db
      .insert(suppliers)
      .values({
        merchantId,
        name: input.name.trim(),
        contactName: input.contactName,
        email: input.email,
        phone: input.phone,
        address: (input.address as object) ?? {},
        taxId: input.taxId,
        notes: input.notes,
        status: 'active'
      })
      .returning()
    return ok(row)
  }

  static async updateSupplier(
    db: DB,
    merchantId: string,
    id: string,
    input: {
      name?: string
      contactName?: string
      email?: string
      phone?: string
      address?: Record<string, unknown>
      taxId?: string
      status?: string
      notes?: string
    }
  ) {
    await this.getSupplier(db, merchantId, id)
    const [row] = await db
      .update(suppliers)
      .set({
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.contactName !== undefined && { contactName: input.contactName }),
        ...(input.email !== undefined && { email: input.email }),
        ...(input.phone !== undefined && { phone: input.phone }),
        ...(input.address !== undefined && { address: input.address }),
        ...(input.taxId !== undefined && { taxId: input.taxId }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.notes !== undefined && { notes: input.notes })
      })
      .where(and(eq(suppliers.id, id), eq(suppliers.merchantId, merchantId)))
      .returning()
    return ok(row)
  }

  /* --------------------------------- purchase orders -------------------------------- */

  static async listPurchaseOrders(
    db: DB,
    merchantId: string,
    q: { page?: string; limit?: string; status?: string; supplierId?: string }
  ) {
    const { page, limit, offset } = parsePagination(q)
    const conditions = [eq(purchaseOrders.merchantId, merchantId)]
    if (q.status) conditions.push(eq(purchaseOrders.status, q.status))
    if (q.supplierId) conditions.push(eq(purchaseOrders.supplierId, q.supplierId))
    const where = and(...conditions)

    const [{ total }] = await db
      .select({ total: count() })
      .from(purchaseOrders)
      .where(where)

    const rows = await db
      .select({
        id: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        supplierId: purchaseOrders.supplierId,
        status: purchaseOrders.status,
        subtotal: purchaseOrders.subtotal,
        expectedAt: purchaseOrders.expectedAt,
        approvedAt: purchaseOrders.approvedAt,
        createdAt: purchaseOrders.createdAt,
        supplierName: suppliers.name,
        itemCount: sql<number>`count(${purchaseOrderItems.id})`,
        orderedQty: sql<number>`coalesce(sum(${purchaseOrderItems.quantity}), 0)`,
        receivedQty: sql<number>`coalesce(sum(${purchaseOrderItems.receivedQuantity}), 0)`
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .leftJoin(purchaseOrderItems, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
      .where(where)
      .groupBy(purchaseOrders.id, suppliers.name)
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(limit)
      .offset(offset)

    return ok({ items: rows, meta: makeMeta(page, limit, Number(total)) })
  }

  static async getPurchaseOrder(db: DB, merchantId: string, id: string) {
    const po = await assertPoInMerchant(db, merchantId, id)
    const [supplier] = await db
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, po.supplierId))
    const items = await db
      .select({
        id: purchaseOrderItems.id,
        variantId: purchaseOrderItems.variantId,
        quantity: purchaseOrderItems.quantity,
        unitCost: purchaseOrderItems.unitCost,
        receivedQuantity: purchaseOrderItems.receivedQuantity,
        sku: productVariants.sku,
        optionValues: productVariants.optionValues,
        productId: products.id,
        productName: products.name,
        productSku: products.sku
      })
      .from(purchaseOrderItems)
      .innerJoin(productVariants, eq(purchaseOrderItems.variantId, productVariants.id))
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(eq(purchaseOrderItems.purchaseOrderId, id))

    const receipts = await db
      .select({
        id: goodsReceipts.id,
        receiptNumber: goodsReceipts.receiptNumber,
        purchaseOrderId: goodsReceipts.purchaseOrderId,
        warehouseId: goodsReceipts.warehouseId,
        notes: goodsReceipts.notes,
        createdAt: goodsReceipts.createdAt,
        warehouseName: warehouses.name
      })
      .from(goodsReceipts)
      .innerJoin(warehouses, eq(goodsReceipts.warehouseId, warehouses.id))
      .where(eq(goodsReceipts.purchaseOrderId, id))
      .orderBy(desc(goodsReceipts.createdAt))

    return ok({ ...po, supplier, items, receipts })
  }

  static async createPurchaseOrder(
    db: DB,
    merchantId: string,
    input: {
      supplierId: string
      expectedAt?: string
      notes?: string
      items: Array<{ variantId: string; quantity: number; unitCost: number }>
    }
  ) {
    await this.getSupplier(db, merchantId, input.supplierId)
    if (!input.items.length) throw badRequest('NO_ITEMS', 'A purchase order needs at least one item')
    await this.validateItems(db, merchantId, input.items)

    const subtotal = this.subtotal(db, input.items)
    const [po] = await db
      .insert(purchaseOrders)
      .values({
        merchantId,
        poNumber: nextNumber('#PO'),
        supplierId: input.supplierId,
        status: 'draft',
        expectedAt: input.expectedAt ? new Date(input.expectedAt) : null,
        notes: input.notes,
        subtotal
      })
      .returning()

    await db.insert(purchaseOrderItems).values(
      input.items.map((it) => ({
        purchaseOrderId: po.id,
        variantId: it.variantId,
        quantity: it.quantity,
        unitCost: it.unitCost,
        receivedQuantity: 0
      }))
    )

    return ok({ ...po, items: input.items })
  }

  static async updatePurchaseOrder(
    db: DB,
    merchantId: string,
    id: string,
    input: {
      supplierId?: string
      expectedAt?: string
      notes?: string
      items?: Array<{ variantId: string; quantity: number; unitCost: number }>
    }
  ) {
    const po = await assertPoInMerchant(db, merchantId, id)
    if (po.status !== 'draft') throw conflict('PO_LOCKED', 'Only draft purchase orders can be edited')

    if (input.supplierId) await this.getSupplier(db, merchantId, input.supplierId)

    const patch: Record<string, unknown> = {
      ...(input.supplierId !== undefined && { supplierId: input.supplierId }),
      ...(input.expectedAt !== undefined && { expectedAt: input.expectedAt ? new Date(input.expectedAt) : null }),
      ...(input.notes !== undefined && { notes: input.notes })
    }

    if (input.items) {
      if (!input.items.length) throw badRequest('NO_ITEMS', 'A purchase order needs at least one item')
      await this.validateItems(db, merchantId, input.items)
      const subtotal = this.subtotal(db, input.items)
      patch.subtotal = subtotal
    }

    const [updated] = await db
      .update(purchaseOrders)
      .set(patch)
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.merchantId, merchantId)))
      .returning()

    if (input.items) {
      await db.delete(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, id))
      await db.insert(purchaseOrderItems).values(
        input.items.map((it) => ({
          purchaseOrderId: id,
          variantId: it.variantId,
          quantity: it.quantity,
          unitCost: it.unitCost,
          receivedQuantity: 0
        }))
      )
    }

    return ok(updated)
  }

  /** Validates every item references a variant owned by this merchant. */
  private static async validateItems(
    db: DB,
    merchantId: string,
    items: Array<{ variantId: string; quantity: number; unitCost: number }>
  ) {
    for (const it of items) {
      if (!Number.isInteger(it.quantity) || it.quantity <= 0) {
        throw badRequest('INVALID_QUANTITY', 'Item quantity must be a positive integer')
      }
      if (typeof it.unitCost !== 'number' || it.unitCost < 0) {
        throw badRequest('INVALID_COST', 'Item unit cost must be non-negative')
      }
      const [variant] = await db
        .select({ id: productVariants.id })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(and(eq(productVariants.id, it.variantId), eq(products.merchantId, merchantId)))
      if (!variant) throw notFound('VARIANT_NOT_FOUND', `Variant ${it.variantId} is not a valid product for this merchant`)
    }
  }

  private static subtotal(db: DB, items: Array<{ quantity: number; unitCost: number }>) {
    return Math.round(items.reduce((sum, it) => sum + it.quantity * it.unitCost, 0) * 1000) / 1000
  }

  static async transitionPurchaseOrder(db: DB, merchantId: string, id: string, to: string, userId?: string) {
    const po = await assertPoInMerchant(db, merchantId, id)
    const allowed = PO_STATUS_TRANSITIONS[po.status as string] ?? []
    if (!allowed.includes(to)) {
      throw conflict('BAD_TRANSITION', `Cannot move a ${po.status} purchase order to ${to}`)
    }

    // Cancel is blocked once any quantity has been received. A matching
    // return (see returnGoods, which decrements receivedQuantity) restores
    // cancellability by bringing the net received quantity back to zero.
    if (to === 'cancelled') {
      const lines = await db
        .select({ receivedQuantity: purchaseOrderItems.receivedQuantity })
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.purchaseOrderId, id))
      if (lines.some((l) => (l.receivedQuantity ?? 0) > 0)) {
        throw conflict('PO_HAS_RECEIPTS', 'Cannot cancel a purchase order with received goods — return them first')
      }
    }

    const patch: Record<string, unknown> = { status: to }
    if (to === 'approved') {
      patch.approvedAt = new Date()
      patch.approvedBy = userId
    }

    const [updated] = await db
      .update(purchaseOrders)
      .set(patch)
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.merchantId, merchantId)))
      .returning()

    emit(merchantId, 'purchase-order.updated', { id, status: to })
    return ok(updated)
  }

  /* --------------------------------- goods receipts -------------------------------- */

  static async listGoodsReceipts(db: DB, merchantId: string, q: { page?: string; limit?: string; purchaseOrderId?: string }) {
    const { page, limit, offset } = parsePagination(q)
    const conditions = [eq(goodsReceipts.merchantId, merchantId)]
    if (q.purchaseOrderId) conditions.push(eq(goodsReceipts.purchaseOrderId, q.purchaseOrderId))
    const where = and(...conditions)

    const [{ total }] = await db
      .select({ total: count() })
      .from(goodsReceipts)
      .where(where)

    const rows = await db
      .select({
        id: goodsReceipts.id,
        receiptNumber: goodsReceipts.receiptNumber,
        purchaseOrderId: goodsReceipts.purchaseOrderId,
        warehouseId: goodsReceipts.warehouseId,
        notes: goodsReceipts.notes,
        createdAt: goodsReceipts.createdAt,
        poNumber: purchaseOrders.poNumber,
        warehouseName: warehouses.name,
        itemCount: sql<number>`count(${goodsReceiptItems.id})`,
        totalQty: sql<number>`coalesce(sum(${goodsReceiptItems.quantity}), 0)`
      })
      .from(goodsReceipts)
      .innerJoin(purchaseOrders, eq(goodsReceipts.purchaseOrderId, purchaseOrders.id))
      .innerJoin(warehouses, eq(goodsReceipts.warehouseId, warehouses.id))
      .leftJoin(goodsReceiptItems, eq(goodsReceiptItems.goodsReceiptId, goodsReceipts.id))
      .where(where)
      .groupBy(goodsReceipts.id, purchaseOrders.poNumber, warehouses.name)
      .orderBy(desc(goodsReceipts.createdAt))
      .limit(limit)
      .offset(offset)

    return ok({ items: rows, meta: makeMeta(page, limit, Number(total)) })
  }

  static async getGoodsReceipt(db: DB, merchantId: string, id: string) {
    const [row] = await db
      .select()
      .from(goodsReceipts)
      .where(and(eq(goodsReceipts.id, id), eq(goodsReceipts.merchantId, merchantId)))
    if (!row) throw notFound('RECEIPT_NOT_FOUND', 'Goods receipt not found')

    const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, row.purchaseOrderId))
    const [warehouse] = await db.select().from(warehouses).where(eq(warehouses.id, row.warehouseId))
    const items = await db
      .select({
        id: goodsReceiptItems.id,
        purchaseOrderItemId: goodsReceiptItems.purchaseOrderItemId,
        variantId: goodsReceiptItems.variantId,
        quantity: goodsReceiptItems.quantity,
        unitCost: goodsReceiptItems.unitCost,
        sku: productVariants.sku,
        optionValues: productVariants.optionValues,
        productId: products.id,
        productName: products.name
      })
      .from(goodsReceiptItems)
      .innerJoin(productVariants, eq(goodsReceiptItems.variantId, productVariants.id))
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(eq(goodsReceiptItems.goodsReceiptId, id))

    return ok({ ...row, purchaseOrder: po, warehouse, items })
  }

  /**
   * Records a goods receipt for an approved PO and moves stock into warehouses.
   * Multi-warehouse putaway: each line may carry its own `warehouseId` which
   * overrides the header `warehouseId` (the header remains the default and is
   * stored on the receipt row for backward compatibility).
   */
  static async receiveGoods(
    db: DB,
    merchantId: string,
    poId: string,
    userId: string,
    input: {
      warehouseId?: string
      notes?: string
      items: Array<{ purchaseOrderItemId: string; quantity: number; warehouseId?: string }>
    }
  ) {
    if (!input.items.length) throw badRequest('NO_ITEMS', 'A goods receipt needs at least one item')

    const po = await assertPoInMerchant(db, merchantId, poId)
    if (!['approved', 'partial'].includes(po.status as string)) {
      throw conflict('PO_NOT_APPROVED', 'Only approved purchase orders can be received')
    }

    const poItems = await db
      .select()
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, poId))

    // Resolve + validate the warehouse for every line up front so no partial
    // validation error can occur after stock has moved.
    const warehouseCache = new Map<string, { id: string }>()
    const resolveWarehouse = async (id: string | undefined, fallback: string | undefined) => {
      const wid = id ?? fallback
      if (!wid) throw badRequest('WAREHOUSE_REQUIRED', 'Each receipt line needs a warehouseId')
      const cached = warehouseCache.get(wid)
      if (cached) return cached
      const [wh] = await db
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.id, wid), eq(warehouses.merchantId, merchantId)))
      if (!wh) throw notFound('WAREHOUSE_NOT_FOUND', `Warehouse ${wid} not found`)
      warehouseCache.set(wid, wh)
      return wh
    }

    const headerWarehouse = input.warehouseId
      ? await resolveWarehouse(input.warehouseId, undefined)
      : null
    if (!headerWarehouse) {
      // No header default: every line must name its own warehouse.
      for (const line of input.items) {
        if (!line.warehouseId) throw badRequest('WAREHOUSE_REQUIRED', 'Provide a header warehouseId or a warehouseId per line')
      }
    }

    // Validate each receipt line: belongs to this PO, quantity positive and not
    // exceeding the outstanding balance.
    const byId = new Map(poItems.map((i) => [i.id, i]))
    const incoming: Array<{ poItem: (typeof poItems)[number]; quantity: number; warehouseId: string }> = []
    for (const line of input.items) {
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        throw badRequest('INVALID_QUANTITY', 'Receipt quantity must be a positive integer')
      }
      const poItem = byId.get(line.purchaseOrderItemId)
      if (!poItem) throw badRequest('INVALID_ITEM', `Item ${line.purchaseOrderItemId} is not on this purchase order`)
      const outstanding = poItem.quantity - poItem.receivedQuantity
      if (line.quantity > outstanding) {
        throw badRequest(
          'OVER_RECEIPT',
          `Item ${poItem.variantId} has ${outstanding} outstanding but ${line.quantity} was received`
        )
      }
      const wh = await resolveWarehouse(line.warehouseId, input.warehouseId)
      incoming.push({ poItem, quantity: line.quantity, warehouseId: wh.id })
    }

// Safe line-level receivedQuantity update requires the NEW received totals per item.
  const receiptNumber = nextNumber('#GR')
  let txReceiptId: string | null = null
    const newItemTotals = new Map(
      poItems.map((i) => [i.id, i.receivedQuantity + (incoming.filter((x) => x.poItem.id === i.id).reduce((s, x) => s + x.quantity, 0))])
    )
    const allItemsFilled = poItems.every((i) => (newItemTotals.get(i.id) ?? 0) >= i.quantity)
    const status: string = allItemsFilled ? 'received' : 'partial'
    const receiptWarehouseId = headerWarehouse?.id ?? incoming[0].warehouseId

    await db.transaction(async (tx: Tx) => {
      const [receipt] = await tx
        .insert(goodsReceipts)
        .values({
          merchantId,
          receiptNumber,
          purchaseOrderId: poId,
          warehouseId: receiptWarehouseId,
          notes: input.notes,
          createdBy: userId
        })
        .returning()

      // Hold the receipt id so the caller can fetch it after commit.
      txReceiptId = receipt.id

      await tx.insert(goodsReceiptItems).values(
        incoming.map(({ poItem, quantity }) => ({
          goodsReceiptId: receipt.id,
          purchaseOrderItemId: poItem.id,
          variantId: poItem.variantId,
          quantity,
          unitCost: poItem.unitCost
        }))
      )

      for (const { poItem, quantity, warehouseId } of incoming) {
        // Split putaway: move stock into the line's warehouse.
        await tx
          .insert(warehouseInventory)
          .values({ merchantId, warehouseId, variantId: poItem.variantId, quantity })
          .onConflictDoUpdate({
            target: [warehouseInventory.warehouseId, warehouseInventory.variantId],
            set: { quantity: sql`${warehouseInventory.quantity} + ${quantity}`, updatedAt: new Date() }
          })

        // Update the line's received quantity.
        await tx
          .update(purchaseOrderItems)
          .set({ receivedQuantity: sql`${purchaseOrderItems.receivedQuantity} + ${quantity}` })
          .where(eq(purchaseOrderItems.id, poItem.id))
      }

      // Reflect the receipt on the merchant's global variant stock (the checkout
      // path decrements the same ledger, so inbound must increment it too).
      const variantTotals = new Map<string, number>()
      for (const { poItem, quantity } of incoming) {
        variantTotals.set(poItem.variantId, (variantTotals.get(poItem.variantId) ?? 0) + quantity)
      }
      for (const [variantId, quantity] of variantTotals) {
        const [variant] = await tx
          .select({ inventory: productVariants.inventory })
          .from(productVariants)
          .where(eq(productVariants.id, variantId))
          .for('update')
        if (variant) {
          await setVariantInventoryTx(tx, merchantId, variantId, variant.inventory + quantity, {
            reason: 'purchase',
            reference: receiptNumber
          })
        }
      }

      await tx
        .update(purchaseOrders)
        .set({ status, approvedAt: po.approvedAt })
        .where(eq(purchaseOrders.id, poId))
    })

    for (const [variantId, quantity] of incoming.reduce((m, { poItem, quantity }) => {
      m.set(poItem.variantId, (m.get(poItem.variantId) ?? 0) + quantity)
      return m
    }, new Map<string, number>())) {
      emit(merchantId, 'inventory.updated', { variantId, change: quantity })
    }
    emit(merchantId, 'purchase-order.updated', { id: poId, status })

    return ok({ receiptId: txReceiptId, receiptNumber, status })
  }

  /**
   * Return (reverse) previously received goods: decrements the warehouse and
   * the global variant ledger (inventoryLogs reason 'return') and decrements
   * the PO line receivedQuantity. Recorded as a `#RTN` goods receipt so the
   * paper trail stays queryable via the existing receipts endpoints. A PO
   * whose net received quantity returns to zero becomes cancellable again.
   */
  static async returnGoods(
    db: DB,
    merchantId: string,
    poId: string,
    userId: string,
    input: {
      warehouseId?: string
      notes?: string
      items: Array<{ purchaseOrderItemId: string; quantity: number; warehouseId?: string }>
    }
  ) {
    if (!input.items.length) throw badRequest('NO_ITEMS', 'A return needs at least one item')
    const po = await assertPoInMerchant(db, merchantId, poId)
    if (!['approved', 'partial', 'received'].includes(po.status as string)) {
      throw conflict('PO_NOT_RECEIVABLE', 'Only approved/received purchase orders can be returned')
    }
    const poItems = await db
      .select()
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, poId))
    const byId = new Map(poItems.map((i) => [i.id, i]))

    const warehouseCache = new Map<string, { id: string }>()
    const resolveWarehouse = async (id: string | undefined, fallback: string | undefined) => {
      const wid = id ?? fallback
      if (!wid) throw badRequest('WAREHOUSE_REQUIRED', 'Each return line needs a warehouseId')
      const cached = warehouseCache.get(wid)
      if (cached) return cached
      const [wh] = await db
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.id, wid), eq(warehouses.merchantId, merchantId)))
      if (!wh) throw notFound('WAREHOUSE_NOT_FOUND', `Warehouse ${wid} not found`)
      warehouseCache.set(wid, wh)
      return wh
    }

    const outgoing: Array<{ poItem: (typeof poItems)[number]; quantity: number; warehouseId: string }> = []
    for (const line of input.items) {
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        throw badRequest('INVALID_QUANTITY', 'Return quantity must be a positive integer')
      }
      const poItem = byId.get(line.purchaseOrderItemId)
      if (!poItem) throw badRequest('INVALID_ITEM', `Item ${line.purchaseOrderItemId} is not on this purchase order`)
      if (line.quantity > poItem.receivedQuantity) {
        throw badRequest('OVER_RETURN', `Item ${poItem.variantId} has only ${poItem.receivedQuantity} received but ${line.quantity} was returned`)
      }
      const wh = await resolveWarehouse(line.warehouseId, input.warehouseId)
      // The warehouse must actually hold the stock being returned.
      const [held] = await db
        .select({ quantity: warehouseInventory.quantity })
        .from(warehouseInventory)
        .where(and(eq(warehouseInventory.warehouseId, wh.id), eq(warehouseInventory.variantId, poItem.variantId)))
      if (!held || held.quantity < line.quantity) {
        throw badRequest('INSUFFICIENT_WAREHOUSE_STOCK', `Warehouse holds ${held?.quantity ?? 0} of variant ${poItem.variantId}, cannot return ${line.quantity}`)
      }
      outgoing.push({ poItem, quantity: line.quantity, warehouseId: wh.id })
    }

    const receiptNumber = nextNumber('#RTN')
    let txReceiptId: string | null = null
    const newItemTotals = new Map(
      poItems.map((i) => [i.id, i.receivedQuantity - outgoing.filter((x) => x.poItem.id === i.id).reduce((s, x) => s + x.quantity, 0)])
    )
    const allZero = poItems.every((i) => (newItemTotals.get(i.id) ?? 0) <= 0)
    const allFilled = poItems.every((i) => (newItemTotals.get(i.id) ?? 0) >= i.quantity)
    const status: string = allZero ? 'approved' : allFilled ? 'received' : 'partial'
    const receiptWarehouseId = (input.warehouseId ?? outgoing[0].warehouseId) as string

    await db.transaction(async (tx: Tx) => {
      const [receipt] = await tx
        .insert(goodsReceipts)
        .values({
          merchantId,
          receiptNumber,
          purchaseOrderId: poId,
          warehouseId: receiptWarehouseId,
          notes: input.notes ?? `Return against ${po.poNumber}`,
          createdBy: userId
        })
        .returning()
      txReceiptId = receipt.id
      await tx.insert(goodsReceiptItems).values(
        outgoing.map(({ poItem, quantity }) => ({
          goodsReceiptId: receipt.id,
          purchaseOrderItemId: poItem.id,
          variantId: poItem.variantId,
          // Stored positive; the `#RTN` number + 'return' log rows mark direction.
          quantity,
          unitCost: poItem.unitCost
        }))
      )
      for (const { poItem, quantity, warehouseId } of outgoing) {
        await tx
          .update(warehouseInventory)
          .set({ quantity: sql`${warehouseInventory.quantity} - ${quantity}`, updatedAt: new Date() })
          .where(and(eq(warehouseInventory.warehouseId, warehouseId), eq(warehouseInventory.variantId, poItem.variantId)))
        await tx
          .update(purchaseOrderItems)
          .set({ receivedQuantity: sql`${purchaseOrderItems.receivedQuantity} - ${quantity}` })
          .where(eq(purchaseOrderItems.id, poItem.id))
      }
      const variantTotals = new Map<string, number>()
      for (const { poItem, quantity } of outgoing) {
        variantTotals.set(poItem.variantId, (variantTotals.get(poItem.variantId) ?? 0) + quantity)
      }
      for (const [variantId, quantity] of variantTotals) {
        const [variant] = await tx
          .select({ inventory: productVariants.inventory })
          .from(productVariants)
          .where(eq(productVariants.id, variantId))
          .for('update')
        if (variant) {
          if (variant.inventory < quantity) {
            throw badRequest('INSUFFICIENT_STOCK', `Global stock of variant ${variantId} is ${variant.inventory}, cannot return ${quantity}`)
          }
          await setVariantInventoryTx(tx, merchantId, variantId, variant.inventory - quantity, {
            reason: 'return',
            reference: receiptNumber
          })
        }
      }
      await tx.update(purchaseOrders).set({ status }).where(eq(purchaseOrders.id, poId))
    })

    for (const [variantId, quantity] of outgoing.reduce((m, { poItem, quantity }) => {
      m.set(poItem.variantId, (m.get(poItem.variantId) ?? 0) + quantity)
      return m
    }, new Map<string, number>())) {
      emit(merchantId, 'inventory.updated', { variantId, change: -quantity })
    }
    emit(merchantId, 'purchase-order.updated', { id: poId, status })
    return ok({ receiptId: txReceiptId, receiptNumber, status })
  }

  /** Deletes a supplier only when no purchase orders reference it. */
  static async deleteSupplier(db: DB, merchantId: string, id: string) {
    await this.getSupplier(db, merchantId, id)
    const existing = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.supplierId, id), eq(purchaseOrders.merchantId, merchantId)))
      .limit(1)
    if (existing.length) throw conflict('SUPPLIER_HAS_POS', 'Cannot delete a supplier with purchase orders')
    await db.delete(suppliers).where(and(eq(suppliers.id, id), eq(suppliers.merchantId, merchantId)))
    return ok({ deleted: true, id })
  }

  /** Deletes a draft purchase order (with its lines). Nothing else is deletable. */
  static async deletePurchaseOrder(db: DB, merchantId: string, id: string) {
    const po = await assertPoInMerchant(db, merchantId, id)
    if (po.status !== 'draft') throw conflict('PO_NOT_DRAFT', 'Only draft purchase orders can be deleted')
    await db.delete(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, id))
    await db.delete(purchaseOrders).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.merchantId, merchantId)))
    return ok({ deleted: true, id })
  }
}