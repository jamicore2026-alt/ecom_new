import { and, count, desc, eq, gte, gt, ilike, lte, or, sql } from 'drizzle-orm'
import { db } from '../../database/client'
import { categories, inventoryLogs, products, productVariants } from '../../database/schema'
import { makeMeta, parsePagination } from '../../shared/pagination'
import { ok } from '../../shared/response'
import { badRequest, notFound } from '../../shared/errors'

const variantWithProduct = {
  id: productVariants.id,
  productId: productVariants.productId,
  sku: productVariants.sku,
  optionValues: productVariants.optionValues,
  price: productVariants.price,
  compareAtPrice: productVariants.compareAtPrice,
  inventory: productVariants.inventory,
  image: productVariants.image,
  createdAt: productVariants.createdAt,
  productName: products.name,
  productStatus: products.status,
  productSku: products.sku,
  lowStockThreshold: products.lowStockThreshold,
  trackInventory: products.trackInventory,
  categoryName: categories.name
}

export class InventoryService {
  static async list(merchantId: string, q: { page?: string; limit?: string; search?: string; status?: string }) {
    const { page, limit, offset } = parsePagination(q)
    const conditions = [eq(products.merchantId, merchantId)]
    if (q.search) {
      const s = `%${q.search.trim()}%`
      const cond = or(ilike(products.name, s), ilike(productVariants.sku, s), ilike(products.sku, s))
      if (cond) conditions.push(cond)
    }
    if (q.status) conditions.push(eq(products.status, q.status))
    const where = and(...conditions)

    const [{ total }] = await db
      .select({ total: count() })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(where)

    const rows = await db
      .select(variantWithProduct)
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(where)
      .orderBy(desc(products.name), desc(productVariants.inventory))
      .limit(limit)
      .offset(offset)

    return ok({ items: rows, meta: makeMeta(page, limit, Number(total)) })
  }

  static async lowStock(merchantId: string, q: { page?: string; limit?: string }) {
    const { page, limit, offset } = parsePagination(q)
    const where = and(
      eq(products.merchantId, merchantId),
      gt(productVariants.inventory, 0),
      lte(productVariants.inventory, products.lowStockThreshold)
    )
    const [{ total }] = await db
      .select({ total: count() })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(where)
    const rows = await db
      .select(variantWithProduct)
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(where)
      .orderBy(sql`${productVariants.inventory} asc`)
      .limit(limit)
      .offset(offset)
    return ok({ items: rows, meta: makeMeta(page, limit, Number(total)) })
  }

  static async outOfStock(merchantId: string, q: { page?: string; limit?: string }) {
    const { page, limit, offset } = parsePagination(q)
    const where = and(eq(products.merchantId, merchantId), eq(productVariants.inventory, 0))
    const [{ total }] = await db
      .select({ total: count() })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(where)
    const rows = await db
      .select(variantWithProduct)
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(where)
      .orderBy(desc(products.name))
      .limit(limit)
      .offset(offset)
    return ok({ items: rows, meta: makeMeta(page, limit, Number(total)) })
  }

  static async history(
    merchantId: string,
    q: { page?: string; limit?: string; variantId?: string; productId?: string; dateFrom?: string; dateTo?: string }
  ) {
    const { page, limit, offset } = parsePagination(q)
    const conditions = [eq(inventoryLogs.merchantId, merchantId)]
    if (q.variantId) conditions.push(eq(inventoryLogs.variantId, q.variantId))
    if (q.productId) conditions.push(eq(productVariants.productId, q.productId))
    if (q.dateFrom) conditions.push(gte(inventoryLogs.createdAt, new Date(q.dateFrom)))
    if (q.dateTo) conditions.push(lte(inventoryLogs.createdAt, new Date(q.dateTo)))
    const where = and(...conditions)

    const [{ total }] = await db
      .select({ total: count() })
      .from(inventoryLogs)
      .innerJoin(productVariants, eq(inventoryLogs.variantId, productVariants.id))
      .where(where)

    const rows = await db
      .select({
        id: inventoryLogs.id,
        variantId: inventoryLogs.variantId,
        change: inventoryLogs.change,
        beforeValue: inventoryLogs.beforeValue,
        afterValue: inventoryLogs.afterValue,
        reason: inventoryLogs.reason,
        reference: inventoryLogs.reference,
        createdAt: inventoryLogs.createdAt,
        productId: productVariants.productId,
        sku: productVariants.sku,
        productName: products.name,
        optionValues: productVariants.optionValues
      })
      .from(inventoryLogs)
      .innerJoin(productVariants, eq(inventoryLogs.variantId, productVariants.id))
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(where)
      .orderBy(desc(inventoryLogs.createdAt))
      .limit(limit)
      .offset(offset)

    return ok({ items: rows, meta: makeMeta(page, limit, Number(total)) })
  }

  static async adjust(merchantId: string, variantId: string, input: { change: number; reason: string }) {
    if (input.change === 0) throw badRequest('BAD_REQUEST', 'Change must be non-zero')

    const [found] = await db
      .select({ id: productVariants.id })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(and(eq(productVariants.id, variantId), eq(products.merchantId, merchantId)))
    if (!found) throw notFound('NOT_FOUND', 'Variant not found')

    // Locked read-modify-write so a concurrent sale can't lose this adjustment.
    const result = await db.transaction(async (tx) => {
      const [variant] = await tx
        .select()
        .from(productVariants)
        .where(eq(productVariants.id, variantId))
        .for('update')
      const afterValue = variant.inventory + input.change
      if (afterValue < 0) {
        throw badRequest('BAD_REQUEST', `Cannot reduce below zero (current stock ${variant.inventory})`)
      }

      const [updated] = await tx
        .update(productVariants)
        .set({ inventory: afterValue })
        .where(eq(productVariants.id, variantId))
        .returning()

      const [log] = await tx
        .insert(inventoryLogs)
        .values({
          merchantId,
          variantId,
          change: input.change,
          beforeValue: variant.inventory,
          afterValue,
          reason: input.reason
        })
        .returning()

      return { updated, log }
    })

    return ok({ variant: result.updated, log: result.log })
  }
}
