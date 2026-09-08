import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../database/client'
import {
  billOfMaterials,
  bomItems,
  productVariants,
  products,
  productionOrderItems,
  productionOrders,
  warehouseInventory,
  warehouses
} from '../../database/schema'
import { makeMeta, parsePagination } from '../../shared/pagination'
import { ok } from '../../shared/response'
import { badRequest, conflict, notFound } from '../../shared/errors'
import { setVariantInventoryTx } from '../../shared/inventory'
import { emit } from '../../shared/event-dispatch'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const PO_STATUS_TRANSITIONS: Record<string, string[]> = {
  planned: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: []
}

const nextNumber = (prefix: string) =>
  `${prefix}${Date.now().toString(36).toUpperCase()}${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`

const assertBomInMerchant = async (merchantId: string, bomId: string) => {
  const [row] = await db
    .select()
    .from(billOfMaterials)
    .where(and(eq(billOfMaterials.id, bomId), eq(billOfMaterials.merchantId, merchantId)))
  if (!row) throw notFound('BOM_NOT_FOUND', 'Bill of materials not found')
  return row
}

const assertBatchInMerchant = async (merchantId: string, batchId: string) => {
  const [row] = await db
    .select()
    .from(productionOrders)
    .where(and(eq(productionOrders.id, batchId), eq(productionOrders.merchantId, merchantId)))
  if (!row) throw notFound('PRODUCTION_ORDER_NOT_FOUND', 'Production order not found')
  return row
}

export class ProductionService {
  /* ----------------------------------- BOM ---------------------------------- */

  static async listBoms(merchantId: string, q: { page?: string; limit?: string; search?: string; status?: string }) {
    const { page, limit, offset } = parsePagination(q)
    const conditions = [eq(billOfMaterials.merchantId, merchantId)]
    if (q.search) conditions.push(sql`${billOfMaterials.name} ilike ${`%${q.search.trim()}%`}`)
    if (q.status) conditions.push(eq(billOfMaterials.status, q.status))
    const where = and(...conditions)

    const [{ total }] = await db
      .select({ total: count() })
      .from(billOfMaterials)
      .where(where)

    const rows = await db
      .select({
        id: billOfMaterials.id,
        name: billOfMaterials.name,
        outputVariantId: billOfMaterials.outputVariantId,
        outputQuantity: billOfMaterials.outputQuantity,
        status: billOfMaterials.status,
        notes: billOfMaterials.notes,
        createdAt: billOfMaterials.createdAt,
        productName: products.name,
        sku: productVariants.sku,
        optionValues: productVariants.optionValues,
        componentCount: sql<number>`count(${bomItems.id})`
      })
      .from(billOfMaterials)
      .innerJoin(productVariants, eq(billOfMaterials.outputVariantId, productVariants.id))
      .innerJoin(products, eq(productVariants.productId, products.id))
      .leftJoin(bomItems, eq(bomItems.bomId, billOfMaterials.id))
      .where(where)
      .groupBy(billOfMaterials.id, products.name, productVariants.sku, productVariants.optionValues)
      .orderBy(desc(billOfMaterials.createdAt))
      .limit(limit)
      .offset(offset)

    return ok({ items: rows, meta: makeMeta(page, limit, Number(total)) })
  }

  static async getBom(merchantId: string, id: string) {
    const bom = await assertBomInMerchant(merchantId, id)
    const [output] = await db
      .select({
        name: products.name,
        sku: productVariants.sku,
        optionValues: productVariants.optionValues
      })
      .from(billOfMaterials)
      .innerJoin(productVariants, eq(billOfMaterials.outputVariantId, productVariants.id))
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(eq(billOfMaterials.id, id))
    const items = await db
      .select({
        id: bomItems.id,
        variantId: bomItems.variantId,
        quantity: bomItems.quantity,
        productName: products.name,
        sku: productVariants.sku,
        optionValues: productVariants.optionValues
      })
      .from(bomItems)
      .innerJoin(productVariants, eq(bomItems.variantId, productVariants.id))
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(eq(bomItems.bomId, id))
    return ok({ ...bom, output, items })
  }

  static async createBom(
    merchantId: string,
    input: {
      name: string
      outputVariantId: string
      outputQuantity?: number
      notes?: string
      items: Array<{ variantId: string; quantity: number }>
    }
  ) {
    const cleaned = await this.validateBom(merchantId, input, input.outputVariantId)
    const [bom] = await db
      .insert(billOfMaterials)
      .values({
        merchantId,
        name: input.name.trim(),
        outputVariantId: input.outputVariantId,
        outputQuantity: input.outputQuantity ?? 1,
        notes: input.notes,
        status: 'draft'
      })
      .returning()

    await db.insert(bomItems).values(
      cleaned.map((it) => ({ bomId: bom.id, variantId: it.variantId, quantity: it.quantity }))
    )
    return ok({ ...bom, items: cleaned })
  }

  static async updateBom(
    merchantId: string,
    id: string,
    input: {
      name?: string
      notes?: string
      status?: string
      items?: Array<{ variantId: string; quantity: number }>
    }
  ) {
    const bom = await assertBomInMerchant(merchantId, id)

    const patch: Record<string, unknown> = {
      ...(input.name !== undefined && { name: input.name.trim() }),
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.status !== undefined && { status: input.status })
    }

    if (input.items) {
      // Components are locked in once the BOM leaves draft — a later change
      // would rewrite historical consumption.
      if (bom.status !== 'draft') throw conflict('BOM_LOCKED', 'Only draft BOMs can change their components')
      const items = await this.validateBom(merchantId, { items: input.items }, bom.outputVariantId)
      await db.delete(bomItems).where(eq(bomItems.bomId, id))
      await db.insert(bomItems).values(
        items.map((it) => ({ bomId: id, variantId: it.variantId, quantity: it.quantity }))
      )
    }

    const [updated] = await db
      .update(billOfMaterials)
      .set(patch)
      .where(and(eq(billOfMaterials.id, id), eq(billOfMaterials.merchantId, merchantId)))
      .returning()
    return ok(updated)
  }

  /** Validates BOM items and returns them deduped/totaled per variant. */
  private static async validateBom(
    merchantId: string,
    input: { items: Array<{ variantId: string; quantity: number }> },
    outputVariantId: string
  ) {
    if (!input.items.length) throw badRequest('NO_ITEMS', 'A BOM needs at least one component')

    const totals = new Map<string, number>()
    for (const it of input.items) {
      if (!Number.isInteger(it.quantity) || it.quantity <= 0) {
        throw badRequest('INVALID_QUANTITY', 'Component quantity must be a positive integer')
      }
      if (it.variantId === outputVariantId) {
        throw badRequest('SELF_CONSUMPTION', 'A BOM cannot consume its own output')
      }
      totals.set(it.variantId, (totals.get(it.variantId) ?? 0) + it.quantity)
    }

    // Every component must be a real variant owned by this merchant.
    const variantRows = await db
      .select({ id: productVariants.id })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(and(eq(products.merchantId, merchantId), inArray(productVariants.id, Array.from(totals.keys()))))
    const valid = new Set(variantRows.map((v) => v.id))
    for (const variantId of totals.keys()) {
      if (!valid.has(variantId)) throw notFound('VARIANT_NOT_FOUND', `Component ${variantId} is not a valid product for this merchant`)
    }
    return Array.from(totals.entries()).map(([variantId, quantity]) => ({ variantId, quantity }))
  }

  /* ------------------------------ production orders ------------------------------ */

  static async listProductionOrders(
    merchantId: string,
    q: { page?: string; limit?: string; status?: string; bomId?: string }
  ) {
    const { page, limit, offset } = parsePagination(q)
    const conditions = [eq(productionOrders.merchantId, merchantId)]
    if (q.status) conditions.push(eq(productionOrders.status, q.status))
    if (q.bomId) conditions.push(eq(productionOrders.bomId, q.bomId))
    const where = and(...conditions)

    const [{ total }] = await db
      .select({ total: count() })
      .from(productionOrders)
      .where(where)

    const rows = await db
      .select({
        id: productionOrders.id,
        productionNumber: productionOrders.productionNumber,
        bomId: productionOrders.bomId,
        status: productionOrders.status,
        quantity: productionOrders.quantity,
        notes: productionOrders.notes,
        startedAt: productionOrders.startedAt,
        completedAt: productionOrders.completedAt,
        createdAt: productionOrders.createdAt,
        bomName: billOfMaterials.name,
        productName: products.name,
        sku: productVariants.sku,
        optionValues: productVariants.optionValues
      })
      .from(productionOrders)
      .innerJoin(billOfMaterials, eq(productionOrders.bomId, billOfMaterials.id))
      .innerJoin(productVariants, eq(billOfMaterials.outputVariantId, productVariants.id))
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(where)
      .orderBy(desc(productionOrders.createdAt))
      .limit(limit)
      .offset(offset)

    return ok({ items: rows, meta: makeMeta(page, limit, Number(total)) })
  }

  static async getProductionOrder(merchantId: string, id: string) {
    const order = await assertBatchInMerchant(merchantId, id)
    const bom = await db
      .select({
        name: billOfMaterials.name,
        outputQuantity: billOfMaterials.outputQuantity,
        status: billOfMaterials.status
      })
      .from(billOfMaterials)
      .where(eq(billOfMaterials.id, order.bomId))
    const items = await db
      .select({
        id: productionOrderItems.id,
        variantId: productionOrderItems.variantId,
        change: productionOrderItems.change,
        beforeValue: productionOrderItems.beforeValue,
        afterValue: productionOrderItems.afterValue,
        productName: products.name,
        sku: productVariants.sku,
        optionValues: productVariants.optionValues
      })
      .from(productionOrderItems)
      .innerJoin(productVariants, eq(productionOrderItems.variantId, productVariants.id))
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(eq(productionOrderItems.productionOrderId, id))
    return ok({ ...order, bom, items })
  }

  static async createProductionOrder(
    merchantId: string,
    input: { bomId: string; quantity: number; notes?: string }
  ) {
    const bom = await assertBomInMerchant(merchantId, input.bomId)
    if (bom.status !== 'active') throw conflict('BOM_NOT_ACTIVE', 'Only active BOMs can be produced')
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw badRequest('INVALID_QUANTITY', 'Batch quantity must be a positive integer')
    }

    const [order] = await db
      .insert(productionOrders)
      .values({
        merchantId,
        productionNumber: nextNumber('#PR'),
        bomId: input.bomId,
        status: 'planned',
        quantity: input.quantity,
        notes: input.notes
      })
      .returning()
    return ok(order)
  }

  static async transitionProductionOrder(merchantId: string, id: string, to: string) {
    const order = await assertBatchInMerchant(merchantId, id)
    const allowed = PO_STATUS_TRANSITIONS[order.status as string] ?? []
    if (!allowed.includes(to)) {
      throw conflict('BAD_TRANSITION', `Cannot move a ${order.status} production order to ${to}`)
    }

    const patch: Record<string, unknown> = { status: to }
    if (to === 'in_progress') patch.startedAt = new Date()
    if (to === 'completed' || to === 'cancelled') patch.completedAt = to === 'completed' ? new Date() : null
    if (to === 'cancelled') patch.cancelledAt = new Date()

    const [updated] = await db
      .update(productionOrders)
      .set(patch)
      .where(and(eq(productionOrders.id, id), eq(productionOrders.merchantId, merchantId)))
      .returning()
    emit(merchantId, 'production-order.updated', { id, status: to })
    return ok(updated)
  }

  /**
   * Completes the production run: atomically consumes the BOM's components from
   * the global variant ledger and credits the output, snapshotting the scorecard.
   * When a warehouse is provided, the same movements are mirrored there.
   */
  static async completeProduction(
    merchantId: string,
    id: string,
    input: { warehouseId?: string }
  ) {
    const order = await assertBatchInMerchant(merchantId, id)
    if (order.status === 'completed') throw conflict('ALREADY_COMPLETED', 'Production order is already completed')
    if (order.status === 'cancelled') throw conflict('CANCELLED', 'Cancelled production orders cannot be completed')

    const bom = await assertBomInMerchant(merchantId, order.bomId)
    const items = await db
      .select()
      .from(bomItems)
      .where(eq(bomItems.bomId, order.bomId))
    if (!items.length) throw badRequest('EMPTY_BOM', 'This BOM has no components')

    let warehouse: { id: string } | null = null
    if (input.warehouseId) {
      const [w] = await db
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.id, input.warehouseId), eq(warehouses.merchantId, merchantId)))
      if (!w) throw notFound('WAREHOUSE_NOT_FOUND', 'Warehouse not found')
      warehouse = w
    }

    const outputQty = bom.outputQuantity * order.quantity
    const consumed = new Map<string, number>()
    for (const it of items) {
      consumed.set(it.variantId, (consumed.get(it.variantId) ?? 0) + it.quantity * order.quantity)
    }

    const ids = [...consumed.keys(), bom.outputVariantId].sort()
    await db.transaction(async (tx: Tx) => {
      // Lock every touched variant once, in a deterministic order, so the
      // validity check and the ledger writes see a consistent snapshot.
      const locked = new Map<string, number>()
      for (const variantId of ids) {
        const [v] = await tx
          .select({ inventory: productVariants.inventory })
          .from(productVariants)
          .where(eq(productVariants.id, variantId))
          .for('update')
        if (!v) throw notFound('VARIANT_NOT_FOUND', `Variant ${variantId} no longer exists`)
        locked.set(variantId, v.inventory)
      }

      // Enforce availability of every component before mutating anything.
      for (const [variantId, need] of consumed) {
        const have = locked.get(variantId) ?? 0
        if (have < need) {
          throw badRequest(
            'INSUFFICIENT_STOCK',
            `Component variant ${variantId} needs ${need} but only ${have} available`
          )
        }
      }

      // Mirror movements into the target warehouse first (component decrement,
      // output increment), never below zero like the checkout path.
      if (warehouse) {
        for (const [variantId, qty] of consumed) {
          const [row] = await tx
            .select()
            .from(warehouseInventory)
            .where(
              and(eq(warehouseInventory.warehouseId, warehouse.id), eq(warehouseInventory.variantId, variantId))
            )
            .for('update')
          if (row && row.quantity > 0) {
            await tx
              .update(warehouseInventory)
              .set({ quantity: Math.max(0, row.quantity - qty), updatedAt: new Date() })
              .where(eq(warehouseInventory.id, row.id))
          }
        }
        await tx
          .insert(warehouseInventory)
          .values({ merchantId, warehouseId: warehouse.id, variantId: bom.outputVariantId, quantity: outputQty })
          .onConflictDoUpdate({
            target: [warehouseInventory.warehouseId, warehouseInventory.variantId],
            set: { quantity: sql`${warehouseInventory.quantity} + ${outputQty}`, updatedAt: new Date() }
          })
      }

      // The authoritative global ledger move (locked snapshot → write + audit
      // log via the shared helper, reason "production", reference = batch #).
      const scorecard: Array<{
        variantId: string
        change: number
        beforeValue: number
        afterValue: number
      }> = []
      for (const [variantId, qty] of consumed) {
        const before = locked.get(variantId) ?? 0
        const after = before - qty
        await setVariantInventoryTx(tx, merchantId, variantId, after, {
          reason: 'production',
          reference: order.productionNumber
        })
        scorecard.push({ variantId, change: -qty, beforeValue: before, afterValue: after })
      }
      const outBefore = locked.get(bom.outputVariantId) ?? 0
      const outAfter = outBefore + outputQty
      await setVariantInventoryTx(tx, merchantId, bom.outputVariantId, outAfter, {
        reason: 'production',
        reference: order.productionNumber
      })
      scorecard.push({ variantId: bom.outputVariantId, change: outputQty, beforeValue: outBefore, afterValue: outAfter })

      await tx.update(productionOrders).set({ status: 'completed', completedAt: new Date() }).where(eq(productionOrders.id, id))

      await tx.insert(productionOrderItems).values(
        scorecard.map((s) => ({ productionOrderId: id, variantId: s.variantId, change: s.change, beforeValue: s.beforeValue, afterValue: s.afterValue }))
      )
    })

    for (const [variantId, qty] of consumed) {
      emit(merchantId, 'inventory.updated', { variantId, change: -qty })
    }
    emit(merchantId, 'inventory.updated', { variantId: bom.outputVariantId, change: outputQty })
    emit(merchantId, 'production-order.updated', { id, status: 'completed' })

    return ok({ id, status: 'completed', outputQuantity: outputQty })
  }
}