import { and, count, desc, eq, sql } from 'drizzle-orm'
import type { DB } from '../../database/client'
import {
  products,
  productVariants,
  stocktakeItems,
  stocktakeSessions,
  warehouseInventory,
  warehouses
} from '../../database/schema'
import { makeMeta, parsePagination } from '../../shared/pagination'
import { ok } from '../../shared/response'
import { badRequest, conflict, notFound } from '../../shared/errors'
import { setVariantInventoryTx } from '../../shared/inventory'
import { emit } from '../../shared/event-dispatch'

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0]

const assertSession = async (db: DB, merchantId: string, id: string) => {
  const [row] = await db
    .select()
    .from(stocktakeSessions)
    .where(and(eq(stocktakeSessions.id, id), eq(stocktakeSessions.merchantId, merchantId)))
  if (!row) throw notFound('STOCKTAKE_NOT_FOUND', 'Stocktake session not found')
  return row
}

const assertVariantInMerchant = async (db: DB, merchantId: string, variantId: string) => {
  const [row] = await db
    .select({ id: productVariants.id, inventory: productVariants.inventory })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(eq(productVariants.id, variantId), eq(products.merchantId, merchantId)))
  if (!row) throw notFound('VARIANT_NOT_FOUND', `Variant ${variantId} is not a valid product for this merchant`)
  return row
}

/** System snapshot for a new stocktake line: warehouse qty when the session
 *  is warehouse-scoped, otherwise the global variant ledger. */
const snapshotQuantity = async (
  db: DB,
  _merchantId: string,
  warehouseId: string | null,
  variantId: string,
  globalInventory: number
) => {
  if (!warehouseId) return globalInventory
  const [held] = await db
    .select({ quantity: warehouseInventory.quantity })
    .from(warehouseInventory)
    .where(and(eq(warehouseInventory.warehouseId, warehouseId), eq(warehouseInventory.variantId, variantId)))
  return held?.quantity ?? 0
}

export class StocktakeService {
  static async list(db: DB, merchantId: string, q: { page?: string; limit?: string; status?: string }) {
    const { page, limit, offset } = parsePagination(q)
    const conditions = [eq(stocktakeSessions.merchantId, merchantId)]
    if (q.status) conditions.push(eq(stocktakeSessions.status, q.status))
    const where = and(...conditions)
    const [{ total }] = await db.select({ total: count() }).from(stocktakeSessions).where(where)
    const rows = await db
      .select({
        id: stocktakeSessions.id,
        warehouseId: stocktakeSessions.warehouseId,
        status: stocktakeSessions.status,
        notes: stocktakeSessions.notes,
        createdBy: stocktakeSessions.createdBy,
        approvedBy: stocktakeSessions.approvedBy,
        createdAt: stocktakeSessions.createdAt,
        approvedAt: stocktakeSessions.approvedAt,
        warehouseName: warehouses.name,
        itemCount: sql<number>`count(${stocktakeItems.id})`
      })
      .from(stocktakeSessions)
      .leftJoin(warehouses, eq(stocktakeSessions.warehouseId, warehouses.id))
      .leftJoin(stocktakeItems, eq(stocktakeItems.sessionId, stocktakeSessions.id))
      .where(where)
      .groupBy(stocktakeSessions.id, warehouses.name)
      .orderBy(desc(stocktakeSessions.createdAt))
      .limit(limit)
      .offset(offset)
    return ok({ items: rows, meta: makeMeta(page, limit, Number(total)) })
  }

  static async create(
    db: DB,
    merchantId: string,
    userId: string,
    input: { warehouseId?: string; notes?: string }
  ) {
    let warehouseId: string | null = null
    if (input.warehouseId) {
      const [wh] = await db
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.id, input.warehouseId), eq(warehouses.merchantId, merchantId)))
      if (!wh) throw notFound('WAREHOUSE_NOT_FOUND', 'Warehouse not found')
      warehouseId = wh.id
    }
    const [row] = await db
      .insert(stocktakeSessions)
      .values({ merchantId, warehouseId, status: 'draft', notes: input.notes, createdBy: userId })
      .returning()
    return ok(row)
  }

  static async get(db: DB, merchantId: string, id: string) {
    const session = await assertSession(db, merchantId, id)
    const [warehouse] = session.warehouseId
      ? await db.select().from(warehouses).where(eq(warehouses.id, session.warehouseId))
      : [null]
    const items = await db
      .select({
        id: stocktakeItems.id,
        variantId: stocktakeItems.variantId,
        systemQuantity: stocktakeItems.systemQuantity,
        countedQuantity: stocktakeItems.countedQuantity,
        createdAt: stocktakeItems.createdAt,
        sku: productVariants.sku,
        optionValues: productVariants.optionValues,
        productId: products.id,
        productName: products.name
      })
      .from(stocktakeItems)
      .innerJoin(productVariants, eq(stocktakeItems.variantId, productVariants.id))
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(eq(stocktakeItems.sessionId, id))
      .orderBy(desc(stocktakeItems.createdAt))
    const withVariance = items.map((it) => ({
      ...it,
      variance: it.countedQuantity == null ? null : it.countedQuantity - it.systemQuantity
    }))
    return ok({ ...session, warehouse, items: withVariance })
  }

  /** Add (or recount) a line in a draft session, snapshotting system qty on insert. */
  static async addItem(
    db: DB,
    merchantId: string,
    sessionId: string,
    input: { variantId: string; countedQuantity?: number }
  ) {
    const session = await assertSession(db, merchantId, sessionId)
    if (session.status !== 'draft') throw conflict('STOCKTAKE_LOCKED', 'Only draft sessions accept counts')
    const variant = await assertVariantInMerchant(db, merchantId, input.variantId)
    if (input.countedQuantity !== undefined && (!Number.isInteger(input.countedQuantity) || input.countedQuantity < 0)) {
      throw badRequest('INVALID_COUNT', 'Counted quantity must be a non-negative integer')
    }
    const system = await snapshotQuantity(db, merchantId, session.warehouseId, variant.id, variant.inventory)
    const [row] = await db
      .insert(stocktakeItems)
      .values({
        merchantId,
        sessionId,
        variantId: variant.id,
        systemQuantity: system,
        countedQuantity: input.countedQuantity ?? null
      })
      .onConflictDoUpdate({
        target: [stocktakeItems.sessionId, stocktakeItems.variantId],
        // Recount keeps the ORIGINAL system snapshot so the variance stays
        // meaningful; only the counted value moves.
        set: { countedQuantity: input.countedQuantity ?? null }
      })
      .returning()
    return ok({ ...row, variance: row.countedQuantity == null ? null : row.countedQuantity - row.systemQuantity })
  }

  static async setCount(
    db: DB,
    merchantId: string,
    sessionId: string,
    itemId: string,
    countedQuantity: number
  ) {
    const session = await assertSession(db, merchantId, sessionId)
    if (session.status !== 'draft') throw conflict('STOCKTAKE_LOCKED', 'Only draft sessions accept counts')
    if (!Number.isInteger(countedQuantity) || countedQuantity < 0) {
      throw badRequest('INVALID_COUNT', 'Counted quantity must be a non-negative integer')
    }
    const [item] = await db
      .select()
      .from(stocktakeItems)
      .where(and(eq(stocktakeItems.id, itemId), eq(stocktakeItems.sessionId, sessionId)))
    if (!item) throw notFound('STOCKTAKE_ITEM_NOT_FOUND', 'Stocktake item not found')
    const [updated] = await db
      .update(stocktakeItems)
      .set({ countedQuantity })
      .where(eq(stocktakeItems.id, itemId))
      .returning()
    return ok({ ...updated, variance: (updated.countedQuantity ?? countedQuantity) - updated.systemQuantity })
  }

  static async submit(db: DB, merchantId: string, id: string) {
    const session = await assertSession(db, merchantId, id)
    if (session.status !== 'draft') throw conflict('BAD_TRANSITION', `Cannot submit a ${session.status} session`)
    const lines = await db.select().from(stocktakeItems).where(eq(stocktakeItems.sessionId, id))
    if (!lines.length) throw badRequest('NO_ITEMS', 'A stocktake session needs at least one counted item')
    if (lines.some((l) => l.countedQuantity == null)) {
      throw badRequest('UNCOUNTED_ITEMS', 'Every item needs a counted quantity before submit')
    }
    const [updated] = await db
      .update(stocktakeSessions)
      .set({ status: 'submitted' })
      .where(eq(stocktakeSessions.id, id))
      .returning()
    return ok(updated)
  }

  /**
   * Approve a submitted session: applies each variance to the global variant
   * ledger (absolute set, inventoryLogs reason 'stocktake', reference =
   * session id) and, when the session is warehouse-scoped, mirrors the
   * counted value into that warehouse's row so detail and global stay aligned.
   */
  static async approve(db: DB, merchantId: string, id: string, userId: string) {
    const session = await assertSession(db, merchantId, id)
    if (session.status !== 'submitted') throw conflict('BAD_TRANSITION', `Only submitted sessions can be approved (current: ${session.status})`)
    const lines = await db.select().from(stocktakeItems).where(eq(stocktakeItems.sessionId, id))
    if (!lines.length) throw badRequest('NO_ITEMS', 'Nothing to approve')
    if (lines.some((l) => l.countedQuantity == null)) {
      throw badRequest('UNCOUNTED_ITEMS', 'Every item needs a counted quantity before approve')
    }

    await db.transaction(async (tx: Tx) => {
      for (const line of lines) {
        const counted = line.countedQuantity as number
        const delta = counted - line.systemQuantity
        if (delta === 0) continue
        const [variant] = await tx
          .select()
          .from(productVariants)
          .where(eq(productVariants.id, line.variantId))
          .for('update')
        if (!variant) continue
        await setVariantInventoryTx(tx, merchantId, line.variantId, variant.inventory + delta, {
          reason: 'stocktake',
          reference: id
        })
        if (session.warehouseId) {
          // Mirror the counted value into the scoped warehouse row. The
          // snapshot was taken from this row, so an absolute write is exact;
          // global was already moved by delta above, keeping both consistent.
          await tx
            .insert(warehouseInventory)
            .values({ merchantId, warehouseId: session.warehouseId, variantId: line.variantId, quantity: counted })
            .onConflictDoUpdate({
              target: [warehouseInventory.warehouseId, warehouseInventory.variantId],
              set: { quantity: counted, updatedAt: new Date() }
            })
        }
      }
      await tx
        .update(stocktakeSessions)
        .set({ status: 'approved', approvedBy: userId, approvedAt: new Date() })
        .where(eq(stocktakeSessions.id, id))
    })

    for (const line of lines) {
      const delta = (line.countedQuantity as number) - line.systemQuantity
      if (delta !== 0) emit(merchantId, 'inventory.updated', { variantId: line.variantId, change: delta })
    }
    const updated = await assertSession(db, merchantId, id)
    return ok(updated)
  }
}
