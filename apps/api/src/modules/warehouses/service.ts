import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { db, type DB } from '../../database/client'
import {
  stockTransfers,
  warehouseInventory,
  warehouses,
  productVariants,
  products
} from '../../database/schema'
import { ok } from '../../shared/response'
import { badRequest, notFound } from '../../shared/errors'

/** Drizzle transaction type matching `db.transaction(...)` callbacks. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

interface TransferVariant {
  variantId: string
  productId: string
  productName: string
  productSku: string | null
  sku: string | null
  optionValues: Record<string, string>
  price: number | null
  /** Global sellable inventory (unallocated pool is global − allocations elsewhere). */
  globalInventory: number
}

export class WarehousesService {
  static async list(db: DB, merchantId: string) {
    const rows = await db
      .select()
      .from(warehouses)
      .where(eq(warehouses.merchantId, merchantId))
      .orderBy(desc(warehouses.isDefault))
    return ok({ items: rows })
  }

  static async get(db: DB, merchantId: string, id: string) {
    const [row] = await db
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.id, id), eq(warehouses.merchantId, merchantId)))
    if (!row) throw notFound('WAREHOUSE_NOT_FOUND', 'Warehouse not found')
    return ok(row)
  }

  static async create(
    db: DB,
    merchantId: string,
    input: {
      name: string
      code: string
      address?: Record<string, unknown>
      isDefault?: boolean
    }
  ) {
    // Only one default warehouse allowed.
    if (input.isDefault) {
      await db
        .update(warehouses)
        .set({ isDefault: false })
        .where(eq(warehouses.merchantId, merchantId))
    }

    const [row] = await db
      .insert(warehouses)
      .values({
        merchantId,
        name: input.name,
        code: input.code,
        address: (input.address as object) ?? {},
        isDefault: input.isDefault ?? false,
        status: 'active'
      })
      .onConflictDoNothing({ target: [warehouses.merchantId, warehouses.code] })
      .returning()

    if (!row) throw badRequest('WAREHOUSE_EXISTS', 'A warehouse with this code already exists')
    return ok(row)
  }

  static async update(
    db: DB,
    merchantId: string,
    id: string,
    input: {
      name?: string
      code?: string
      address?: Record<string, unknown>
      isDefault?: boolean
      status?: string
    }
  ) {
    await this.get(db, merchantId, id)
    if (input.isDefault) {
      await db
        .update(warehouses)
        .set({ isDefault: false })
        .where(eq(warehouses.merchantId, merchantId))
    }
    const [row] = await db
      .update(warehouses)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.code !== undefined && { code: input.code }),
        ...(input.address !== undefined && { address: input.address }),
        ...(input.isDefault !== undefined && { isDefault: true }),
        ...(input.status !== undefined && { status: input.status })
      })
      .where(and(eq(warehouses.id, id), eq(warehouses.merchantId, merchantId)))
      .returning()
    return ok(row)
  }

  static async listInventory(db: DB, merchantId: string, warehouseId: string) {
    const [warehouse] = await db
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.id, warehouseId), eq(warehouses.merchantId, merchantId)))
    if (!warehouse) throw notFound('WAREHOUSE_NOT_FOUND', 'Warehouse not found')

    const rows = await db
      .select({
        id: warehouseInventory.id,
        warehouseId: warehouseInventory.warehouseId,
        variantId: warehouseInventory.variantId,
        quantity: warehouseInventory.quantity,
        updatedAt: warehouseInventory.updatedAt,
        sku: productVariants.sku,
        optionValues: productVariants.optionValues,
        price: productVariants.price,
        productId: products.id,
        productName: products.name,
        productSku: products.sku
      })
      .from(warehouseInventory)
      .innerJoin(productVariants, eq(warehouseInventory.variantId, productVariants.id))
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(eq(warehouseInventory.warehouseId, warehouseId))

    const skus = rows.filter((r) => r.quantity > 0).length
    const stockValue = rows.reduce((sum, r) => sum + r.quantity * (r.price ?? 0), 0)

    return ok({ warehouse, items: rows, skuCount: skus, stockValue })
  }

  /** Set absolute stock for a variant in a warehouse. */
  static async setInventory(
    db: DB,
    merchantId: string,
    warehouseId: string,
    variantId: string,
    quantity: number
  ) {
    const [warehouse] = await db
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.id, warehouseId), eq(warehouses.merchantId, merchantId)))
    if (!warehouse) throw notFound('WAREHOUSE_NOT_FOUND', 'Warehouse not found')

    const [variant] = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, variantId))
    if (!variant) throw notFound('VARIANT_NOT_FOUND', 'Variant not found')

    await db
      .insert(warehouseInventory)
      .values({
        merchantId,
        warehouseId,
        variantId,
        quantity: Math.max(0, quantity)
      })
      .onConflictDoUpdate({
        target: [warehouseInventory.warehouseId, warehouseInventory.variantId],
        set: { quantity: Math.max(0, quantity), updatedAt: new Date() }
      })

    return ok({ warehouseId, variantId, quantity })
  }

  /** Transfer stock between warehouses. */
  static async transfer(
    db: DB,
    merchantId: string,
    input: {
      fromWarehouseId: string
      toWarehouseId: string
      variantId: string
      quantity: number
    }
  ) {
    if (input.quantity <= 0) throw badRequest('INVALID_QUANTITY', 'Quantity must be positive')

    const { from, to } = await this.resolveWarehouses(db, merchantId, input.fromWarehouseId, input.toWarehouseId)
    const variant = await this.resolveTransferVariant(db, merchantId, input.variantId)

    await db.transaction(async (tx) => {
      await this.transferLineTx(tx, merchantId, {
        variant,
        fromWarehouseId: from.id,
        toWarehouseId: to.id,
        quantity: input.quantity,
        kind: 'manual',
        groupKey: null
      })
    })

    return ok({ transferred: true, quantity: input.quantity, kind: 'manual' })
  }

  /**
   * Bulk transfer — PDF-correction: "bulk products transfer, all products with
   * all qtys. Extra option." Two modes:
   *  - `items`: an explicit list of { variantId, quantity } lines.
   *  - `allStock: true`: every variant held by the source warehouse (full
   *    quantity) plus every merchant variant still sitting in the unallocated
   *    global pool. All lines are validated, locked and applied in ONE
   *    transaction and recorded as a single `bulk` batch sharing a groupKey.
   */
  static async transferBulk(
    db: DB,
    merchantId: string,
    input: {
      fromWarehouseId: string
      toWarehouseId: string
      items?: Array<{ variantId: string; quantity: number }>
      allStock?: boolean
    }
  ) {
    const { from, to } = await this.resolveWarehouses(db, merchantId, input.fromWarehouseId, input.toWarehouseId)
    const items = input.items ?? []
    if (items.length === 0 && !input.allStock) {
      throw badRequest('EMPTY_TRANSFER', 'Provide at least one item or enable "transfer all stock"')
    }

    let lines: Array<{ variant: TransferVariant; quantity: number }>
    if (input.allStock) {
      lines = await this.resolveAllStockLines(db, merchantId, from.id, to.id)
      if (lines.length === 0) {
        throw badRequest('EMPTY_TRANSFER', 'There is no stock to transfer from this warehouse')
      }
    } else {
      if (items.some((i) => i.quantity <= 0)) {
        throw badRequest('INVALID_QUANTITY', 'Quantities must be positive')
      }
      const variants = await Promise.all(
        items.map((i) => this.resolveTransferVariant(db, merchantId, i.variantId))
      )
      lines = items.map((i, idx) => ({ variant: variants[idx], quantity: i.quantity }))
    }

    const groupKey = randomUUID()
    await db.transaction(async (tx) => {
      // Lock rows in a deterministic order to avoid deadlocks between
      // concurrent bulk transfers touching overlapping line sets.
      const sorted = [...lines].sort((a, b) => (a.variant.variantId < b.variant.variantId ? -1 : 1))
      for (const line of sorted) {
        await this.transferLineTx(tx, merchantId, {
          variant: line.variant,
          fromWarehouseId: from.id,
          toWarehouseId: to.id,
          quantity: line.quantity,
          kind: 'bulk',
          groupKey
        })
      }
    })

    const quantityTotal = lines.reduce((sum, l) => sum + l.quantity, 0)
    return ok({
      transferred: true,
      groupKey,
      lineCount: lines.length,
      quantityTotal,
      kind: 'bulk'
    })
  }

  /** Load both warehouses and fail fast if either is missing or foreign. */
  private static async resolveWarehouses(db: DB, merchantId: string, fromId: string, toId: string) {
    if (fromId === toId) throw badRequest('SAME_WAREHOUSE', 'Source and destination warehouses must differ')
    const [from] = await db
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.id, fromId), eq(warehouses.merchantId, merchantId)))
    if (!from) throw notFound('WAREHOUSE_NOT_FOUND', 'Source warehouse not found')
    const [to] = await db
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.id, toId), eq(warehouses.merchantId, merchantId)))
    if (!to) throw notFound('WAREHOUSE_NOT_FOUND', 'Destination warehouse not found')
    return { from, to }
  }

  /** Load a variant with its owning product; clean tenant errors instead of a
   *  misleading INSUFFICIENT_STOCK when the variant is unknown or foreign. */
  private static async resolveTransferVariant(db: DB, merchantId: string, variantId: string): Promise<TransferVariant> {
    const [row] = await db
      .select({
        variantId: productVariants.id,
        productId: products.id,
        productName: products.name,
        productSku: products.sku,
        sku: productVariants.sku,
        optionValues: productVariants.optionValues,
        price: productVariants.price,
        globalInventory: productVariants.inventory
      })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(eq(productVariants.id, variantId))
    if (!row || row.productId === null) throw notFound('VARIANT_NOT_FOUND', 'Variant not found')
    const [productOwner] = await db
      .select({ merchantId: products.merchantId })
      .from(products)
      .where(eq(products.id, row.productId))
    if (!productOwner || productOwner.merchantId !== merchantId) {
      throw badRequest('VARIANT_MERCHANT_MISMATCH', 'Variant does not belong to this merchant')
    }
    return {
      variantId: row.variantId,
      productId: row.productId,
      productName: row.productName ?? '',
      productSku: row.productSku,
      sku: row.sku,
      optionValues: (row.optionValues ?? {}) as Record<string, string>,
      price: row.price,
      globalInventory: row.globalInventory
    }
  }

  /**
   * Move a single line inside an open transaction. Locks the variant row so a
   * concurrent move of the same variant (bulk, single, or storefront checkout)
   * serializes against it, then re-validates availability. When the source
   * warehouse has no allocation row, the unallocated global pool is the source:
   * available = global inventory − allocations held in every OTHER warehouse.
   */
  private static async transferLineTx(
    tx: Tx,
    merchantId: string,
    line: {
      variant: TransferVariant
      fromWarehouseId: string
      toWarehouseId: string
      quantity: number
      kind: 'manual' | 'bulk'
      groupKey: string | null
    }
  ) {
    // Serialize per-variant moves (including storefront checkout locks) by
    // locking the variant row itself.
    await tx
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(eq(productVariants.id, line.variant.variantId))
      .for('update')

    const [sourceRow] = await tx
      .select()
      .from(warehouseInventory)
      .where(
        and(
          eq(warehouseInventory.warehouseId, line.fromWarehouseId),
          eq(warehouseInventory.variantId, line.variant.variantId)
        )
      )
      .for('update')

    let available: number
    if (sourceRow) {
      available = sourceRow.quantity
    } else {
      const otherAllocations = await this.otherAllocationsTx(
        tx,
        merchantId,
        line.variant.variantId,
        line.fromWarehouseId
      )
      available = Math.max(0, line.variant.globalInventory - otherAllocations)
    }

    if (available < line.quantity) {
      throw badRequest(
        'INSUFFICIENT_STOCK',
        `Only ${available} unit${available === 1 ? '' : 's'} of this item are available to transfer from this warehouse`
      )
    }

    if (sourceRow) {
      await tx
        .update(warehouseInventory)
        .set({ quantity: sourceRow.quantity - line.quantity, updatedAt: new Date() })
        .where(eq(warehouseInventory.id, sourceRow.id))
    }

    await tx
      .insert(warehouseInventory)
      .values({
        merchantId,
        warehouseId: line.toWarehouseId,
        variantId: line.variant.variantId,
        quantity: line.quantity
      })
      .onConflictDoUpdate({
        target: [warehouseInventory.warehouseId, warehouseInventory.variantId],
        set: {
          quantity: sql`${warehouseInventory.quantity} + ${line.quantity}`,
          updatedAt: new Date()
        }
      })

    // The ledger row lives in the same transaction as the movement so a
    // partial failure can never leave moved stock without a record.
    await tx.insert(stockTransfers).values({
      merchantId,
      kind: line.kind,
      groupKey: line.groupKey,
      fromWarehouseId: line.fromWarehouseId,
      toWarehouseId: line.toWarehouseId,
      variantId: line.variant.variantId,
      quantity: line.quantity,
      status: 'completed',
      completedAt: new Date()
    })
  }

  /** Sum of a variant's allocations across every warehouse except `excludedId`. */
  private static async otherAllocationsTx(
    tx: Tx,
    merchantId: string,
    variantId: string,
    excludedId: string
  ): Promise<number> {
    const [row] = await tx
      .select({ total: sql<number>`coalesce(sum(${warehouseInventory.quantity}), 0)` })
      .from(warehouseInventory)
      .where(
        and(
          eq(warehouseInventory.merchantId, merchantId),
          eq(warehouseInventory.variantId, variantId),
          ne(warehouseInventory.warehouseId, excludedId)
        )
      )
    return Number(row?.total ?? 0)
  }

  /** Enumerate everything a source warehouse can currently hand over: its own
   *  allocations plus the unallocated global pool (variants it doesn't hold). */
  private static async resolveAllStockLines(
    db: DB,
    merchantId: string,
    fromWarehouseId: string,
    toWarehouseId: string
  ): Promise<Array<{ variant: TransferVariant; quantity: number }>> {
    if (fromWarehouseId === toWarehouseId) {
      throw badRequest('SAME_WAREHOUSE', 'Source and destination warehouses must differ')
    }

    const sourceRows = await db
      .select({
        variantId: warehouseInventory.variantId,
        quantity: warehouseInventory.quantity
      })
      .from(warehouseInventory)
      .where(
        and(
          eq(warehouseInventory.merchantId, merchantId),
          eq(warehouseInventory.warehouseId, fromWarehouseId),
          sql`${warehouseInventory.quantity} > 0`
        )
      )

    const heldVariantIds = sourceRows.map((r) => r.variantId)

    // Variants the merchant owns that are NOT already allocated to the source
    // warehouse — their transferable amount is the unallocated pool.
    const poolCandidates = await db
      .select({
        variantId: productVariants.id,
        productId: products.id,
        productName: products.name,
        productSku: products.sku,
        sku: productVariants.sku,
        optionValues: productVariants.optionValues,
        price: productVariants.price,
        globalInventory: productVariants.inventory
      })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(and(eq(products.merchantId, merchantId), eq(products.status, 'active')))

    const poolIds: string[] = poolCandidates
      .filter((p) => p.globalInventory > 0)
      .map((p) => p.variantId)

    const allocationTotals = poolIds.length
      ? await db
          .select({
            variantId: warehouseInventory.variantId,
            total: sql<number>`sum(${warehouseInventory.quantity})`
          })
          .from(warehouseInventory)
          .where(
            and(
              eq(warehouseInventory.merchantId, merchantId),
              ne(warehouseInventory.warehouseId, fromWarehouseId),
              inArray(warehouseInventory.variantId, poolIds)
            )
          )
          .groupBy(warehouseInventory.variantId)
      : []

    const totalsMap = new Map(allocationTotals.map((r) => [r.variantId, Number(r.total ?? 0)]))

    const lines: Array<{ variant: TransferVariant; quantity: number }> = []

    for (const row of sourceRows) {
      const candidate = poolCandidates.find((p) => p.variantId === row.variantId)
      if (!candidate) continue
      lines.push({
        variant: {
          variantId: candidate.variantId,
          productId: candidate.productId,
          productName: candidate.productName,
          productSku: candidate.productSku,
          sku: candidate.sku,
          optionValues: (candidate.optionValues ?? {}) as Record<string, string>,
          price: candidate.price,
          globalInventory: candidate.globalInventory
        },
        quantity: row.quantity
      })
    }

    // Unallocated pool: merchant variants not held in the source warehouse.
    const heldIds = new Set(heldVariantIds)
    for (const candidate of poolCandidates) {
      if (heldIds.has(candidate.variantId)) continue
      const pool = Math.max(0, candidate.globalInventory - (totalsMap.get(candidate.variantId) ?? 0))
      if (pool <= 0) continue
      lines.push({
        variant: {
          variantId: candidate.variantId,
          productId: candidate.productId,
          productName: candidate.productName,
          productSku: candidate.productSku,
          sku: candidate.sku,
          optionValues: (candidate.optionValues ?? {}) as Record<string, string>,
          price: candidate.price,
          globalInventory: candidate.globalInventory
        },
        quantity: pool
      })
    }

    lines.sort((a, b) => (a.variant.productName < b.variant.productName ? -1 : 1))
    return lines
  }

  static async listTransfers(db: DB, merchantId: string) {
    const rows = await db
      .select({
        id: stockTransfers.id,
        kind: stockTransfers.kind,
        groupKey: stockTransfers.groupKey,
        fromWarehouseId: stockTransfers.fromWarehouseId,
        toWarehouseId: stockTransfers.toWarehouseId,
        variantId: stockTransfers.variantId,
        quantity: stockTransfers.quantity,
        status: stockTransfers.status,
        createdAt: stockTransfers.createdAt,
        completedAt: stockTransfers.completedAt
      })
      .from(stockTransfers)
      .where(eq(stockTransfers.merchantId, merchantId))
      .orderBy(desc(stockTransfers.createdAt))

    const enriched = await this.enrichTransfers(db, merchantId, rows)
    return ok({ items: enriched })
  }

  static async getTransfer(db: DB, merchantId: string, id: string) {
    const [row] = await db
      .select()
      .from(stockTransfers)
      .where(and(eq(stockTransfers.id, id), eq(stockTransfers.merchantId, merchantId)))
    if (!row) throw notFound('TRANSFER_NOT_FOUND', 'Transfer not found')

    const [enriched] = await this.enrichTransfers(db, merchantId, [row])
    return ok(enriched)
  }

  /** Join warehouse and product/variant names onto raw transfer rows. */
  private static async enrichTransfers(
    db: DB,
    merchantId: string,
    rows: Array<{
      id: string
      kind: string | null
      groupKey: string | null
      fromWarehouseId: string | null
      toWarehouseId: string | null
      variantId: string
      quantity: number
      status: string | null
      createdAt: Date
      completedAt: Date | null
    }>
  ) {
    if (rows.length === 0) return []

    const warehouseIds = new Set<string>()
    const variantIds = new Set<string>()
    for (const r of rows) {
      if (r.fromWarehouseId) warehouseIds.add(r.fromWarehouseId)
      if (r.toWarehouseId) warehouseIds.add(r.toWarehouseId)
      variantIds.add(r.variantId)
    }

    const warehouseRows = warehouseIds.size
      ? await db
          .select({ id: warehouses.id, name: warehouses.name, code: warehouses.code, status: warehouses.status })
          .from(warehouses)
          .where(and(eq(warehouses.merchantId, merchantId), inArray(warehouses.id, Array.from(warehouseIds))))
      : []
    const variantRows = variantIds.size
      ? await db
          .select({
            id: productVariants.id,
            sku: productVariants.sku,
            optionValues: productVariants.optionValues,
            productId: products.id,
            productName: products.name,
            productSku: products.sku
          })
          .from(productVariants)
          .innerJoin(products, eq(productVariants.productId, products.id))
          .where(and(eq(products.merchantId, merchantId), inArray(productVariants.id, Array.from(variantIds))))
      : []

    const whMap = new Map(warehouseRows.map((w) => [w.id, w]))
    const variantMap = new Map(variantRows.map((v) => [v.id, v]))

    return rows.map((r) => {
      const from = r.fromWarehouseId ? whMap.get(r.fromWarehouseId) : undefined
      const to = r.toWarehouseId ? whMap.get(r.toWarehouseId) : undefined
      const variant = variantMap.get(r.variantId)
      return {
        id: r.id,
        kind: r.kind,
        groupKey: r.groupKey,
        fromWarehouseId: r.fromWarehouseId,
        toWarehouseId: r.toWarehouseId,
        variantId: r.variantId,
        quantity: r.quantity,
        status: r.status,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
        sourceName: from?.name ?? null,
        sourceCode: from?.code ?? null,
        destinationName: to?.name ?? null,
        destinationCode: to?.code ?? null,
        variantSku: variant?.sku ?? null,
        optionValues: variant?.optionValues ?? {},
        productId: variant?.productId ?? null,
        productName: variant?.productName ?? null,
        productSku: variant?.productSku ?? null
      }
    })
  }
}
