import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '../../database/client'
import { stockTransfers, warehouseInventory, warehouses, productVariants } from '../../database/schema'
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
      .select()
      .from(warehouseInventory)
      .where(eq(warehouseInventory.warehouseId, warehouseId))

    return ok({ warehouse, items: rows })
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
      .select()
      .from(stockTransfers)
      .where(eq(stockTransfers.merchantId, merchantId))
      .orderBy(desc(stockTransfers.createdAt))
    return ok({ items: rows })
  }
}
