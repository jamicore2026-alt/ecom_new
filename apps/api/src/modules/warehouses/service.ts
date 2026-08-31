import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../database/client'
import {
  stockTransfers,
  warehouseInventory,
  warehouses,
  productVariants,
  products
} from '../../database/schema'
import { ok } from '../../shared/response'
import { badRequest, notFound } from '../../shared/errors'

export class WarehousesService {
  static async list(merchantId: string) {
    const rows = await db
      .select()
      .from(warehouses)
      .where(eq(warehouses.merchantId, merchantId))
      .orderBy(desc(warehouses.isDefault))
    return ok({ items: rows })
  }

  static async get(merchantId: string, id: string) {
    const [row] = await db
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.id, id), eq(warehouses.merchantId, merchantId)))
    if (!row) throw notFound('WAREHOUSE_NOT_FOUND', 'Warehouse not found')
    return ok(row)
  }

  static async create(
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
    await this.get(merchantId, id)
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

  static async listInventory(merchantId: string, warehouseId: string) {
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
    merchantId: string,
    input: {
      fromWarehouseId: string
      toWarehouseId: string
      variantId: string
      quantity: number
    }
  ) {
    if (input.quantity <= 0) throw badRequest('INVALID_QUANTITY', 'Quantity must be positive')
    if (input.fromWarehouseId === input.toWarehouseId) {
      throw badRequest('SAME_WAREHOUSE', 'Source and destination warehouses must differ')
    }

    const [from] = await db
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.id, input.fromWarehouseId), eq(warehouses.merchantId, merchantId)))
    if (!from) throw notFound('WAREHOUSE_NOT_FOUND', 'Source warehouse not found')
    const [to] = await db
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.id, input.toWarehouseId), eq(warehouses.merchantId, merchantId)))
    if (!to) throw notFound('WAREHOUSE_NOT_FOUND', 'Destination warehouse not found')

    const [fromStock] = await db
      .select()
      .from(warehouseInventory)
      .where(
        and(eq(warehouseInventory.warehouseId, input.fromWarehouseId), eq(warehouseInventory.variantId, input.variantId))
      )
    if (!fromStock || fromStock.quantity < input.quantity) {
      throw badRequest('INSUFFICIENT_STOCK', 'Source warehouse does not have enough stock')
    }

    // Atomically move stock.
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(warehouseInventory)
        .where(
          and(
            eq(warehouseInventory.warehouseId, input.fromWarehouseId),
            eq(warehouseInventory.variantId, input.variantId)
          )
        )
        .for('update')
      if (!locked || locked.quantity < input.quantity) {
        throw badRequest('INSUFFICIENT_STOCK', 'Source warehouse stock changed during transfer')
      }

      await tx
        .update(warehouseInventory)
        .set({ quantity: locked.quantity - input.quantity, updatedAt: new Date() })
        .where(eq(warehouseInventory.id, locked.id))

      await tx
        .insert(warehouseInventory)
        .values({
          merchantId,
          warehouseId: input.toWarehouseId,
          variantId: input.variantId,
          quantity: input.quantity
        })
        .onConflictDoUpdate({
          target: [warehouseInventory.warehouseId, warehouseInventory.variantId],
          set: {
            quantity: sql`${warehouseInventory.quantity} + ${input.quantity}`,
            updatedAt: new Date()
          }
        })
    })

    await db.insert(stockTransfers).values({
      merchantId,
      fromWarehouseId: input.fromWarehouseId,
      toWarehouseId: input.toWarehouseId,
      variantId: input.variantId,
      quantity: input.quantity,
      status: 'completed',
      completedAt: new Date()
    })

    return ok({ transferred: true, quantity: input.quantity })
  }

  static async listTransfers(merchantId: string) {
    const rows = await db
      .select({
        id: stockTransfers.id,
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

    const enriched = await this.enrichTransfers(merchantId, rows)
    return ok({ items: enriched })
  }

  static async getTransfer(merchantId: string, id: string) {
    const [row] = await db
      .select()
      .from(stockTransfers)
      .where(and(eq(stockTransfers.id, id), eq(stockTransfers.merchantId, merchantId)))
    if (!row) throw notFound('TRANSFER_NOT_FOUND', 'Transfer not found')

    const [enriched] = await this.enrichTransfers(merchantId, [row])
    return ok(enriched)
  }

  /** Join warehouse and product/variant names onto raw transfer rows. */
  private static async enrichTransfers(
    merchantId: string,
    rows: Array<{
      id: string
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
