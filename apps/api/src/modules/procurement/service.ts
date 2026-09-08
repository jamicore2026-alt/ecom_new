import { and, count, desc, eq, sql } from 'drizzle-orm'
import { db } from '../../database/client'
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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const assertPoInMerchant = async (merchantId: string, poId: string) => {
  const [row] = await db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.merchantId, merchantId)))
  if (!row) throw notFound('PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found')
  return row
}

export class ProcurementService {
  /* --------------------------------- suppliers -------------------------------- */

  static async listSuppliers(merchantId: string, q: { page?: string; limit?: string; search?: string; status?: string }) {
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

  static async getSupplier(merchantId: string, id: string) {
    const [row] = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, id), eq(suppliers.merchantId, merchantId)))
    if (!row) throw notFound('SUPPLIER_NOT_FOUND', 'Supplier not found')
    return ok(row)
  }

  static async createSupplier(
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
    await this.getSupplier(merchantId, id)
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

  static async getPurchaseOrder(merchantId: string, id: string) {
    const po = await assertPoInMerchant(merchantId, id)
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
    merchantId: string,
    input: {
      supplierId: string
      expectedAt?: string
      notes?: string
      items: Array<{ variantId: string; quantity: number; unitCost: number }>
    }
  ) {
    await this.getSupplier(merchantId, input.supplierId)
    if (!input.items.length) throw badRequest('NO_ITEMS', 'A purchase order needs at least one item')
    this.validateItems(merchantId, input.items)

    const subtotal = this.subtotal(input.items)
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
    merchantId: string,
    id: string,
    input: {
      supplierId?: string
      expectedAt?: string
      notes?: string
      items?: Array<{ variantId: string; quantity: number; unitCost: number }>
    }
  ) {
    const po = await assertPoInMerchant(merchantId, id)
    if (po.status !== 'draft') throw conflict('PO_LOCKED', 'Only draft purchase orders can be edited')

    if (input.supplierId) await this.getSupplier(merchantId, input.supplierId)

    const patch: Record<string, unknown> = {
      ...(input.supplierId !== undefined && { supplierId: input.supplierId }),
      ...(input.expectedAt !== undefined && { expectedAt: input.expectedAt ? new Date(input.expectedAt) : null }),
      ...(input.notes !== undefined && { notes: input.notes })
    }

    if (input.items) {
      if (!input.items.length) throw badRequest('NO_ITEMS', 'A purchase order needs at least one item')
      this.validateItems(merchantId, input.items)
      const subtotal = this.subtotal(input.items)
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

  private static subtotal(items: Array<{ quantity: number; unitCost: number }>) {
    return Math.round(items.reduce((sum, it) => sum + it.quantity * it.unitCost, 0) * 1000) / 1000
  }

  static async transitionPurchaseOrder(merchantId: string, id: string, to: string, userId?: string) {
    const po = await assertPoInMerchant(merchantId, id)
    const allowed = PO_STATUS_TRANSITIONS[po.status as string] ?? []
    if (!allowed.includes(to)) {
      throw conflict('BAD_TRANSITION', `Cannot move a ${po.status} purchase order to ${to}`)
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

  static async listGoodsReceipts(merchantId: string, q: { page?: string; limit?: string; purchaseOrderId?: string }) {
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

  static async getGoodsReceipt(merchantId: string, id: string) {
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

  /** Records a goods receipt for an approved PO and moves stock into the warehouse. */
  static async receiveGoods(
    merchantId: string,
    poId: string,
    userId: string,
    input: { warehouseId: string; notes?: string; items: Array<{ purchaseOrderItemId: string; quantity: number }> }
  ) {
    if (!input.items.length) throw badRequest('NO_ITEMS', 'A goods receipt needs at least one item')

    const po = await assertPoInMerchant(merchantId, poId)
    if (!['approved', 'partial'].includes(po.status as string)) {
      throw conflict('PO_NOT_APPROVED', 'Only approved purchase orders can be received')
    }

    const [wh] = await db
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.id, input.warehouseId), eq(warehouses.merchantId, merchantId)))
    if (!wh) throw notFound('WAREHOUSE_NOT_FOUND', 'Warehouse not found')

    const poItems = await db
      .select()
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, poId))

    // Validate each receipt line: belongs to this PO, quantity positive and not
    // exceeding the outstanding balance.
    const byId = new Map(poItems.map((i) => [i.id, i]))
    const incoming: Array<{ poItem: (typeof poItems)[number]; quantity: number }> = []
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
      incoming.push({ poItem, quantity: line.quantity })
    }

// Safe line-level receivedQuantity update requires the NEW received totals per item.
  const receiptNumber = nextNumber('#GR')
  let txReceiptId: string | null = null
    const newItemTotals = new Map(
      poItems.map((i) => [i.id, i.receivedQuantity + (incoming.filter((x) => x.poItem.id === i.id).reduce((s, x) => s + x.quantity, 0))])
    )
    const allItemsFilled = poItems.every((i) => (newItemTotals.get(i.id) ?? 0) >= i.quantity)
    const status: string = allItemsFilled ? 'received' : 'partial'

    await db.transaction(async (tx: Tx) => {
      const [receipt] = await tx
        .insert(goodsReceipts)
        .values({
          merchantId,
          receiptNumber,
          purchaseOrderId: poId,
          warehouseId: input.warehouseId,
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

      for (const { poItem, quantity } of incoming) {
        // Move stock into the target warehouse.
        await tx
          .insert(warehouseInventory)
          .values({ merchantId, warehouseId: input.warehouseId, variantId: poItem.variantId, quantity })
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
}