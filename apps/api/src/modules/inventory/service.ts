import { and, count, desc, eq, gte, gt, ilike, lte, or, sql } from 'drizzle-orm'
import type { DB } from '../../database/client'
import {
  categories,
  inventoryLogs,
  merchants,
  notificationSettings,
  products,
  productVariants
} from '../../database/schema'
import { makeMeta, parsePagination } from '../../shared/pagination'
import { ok } from '../../shared/response'
import { emit } from '../../shared/event-dispatch'
import { badRequest, notFound } from '../../shared/errors'
import { getMailer, renderEmail } from '../../shared/mailer'
import { createLogger } from '../../shared/logger'

const log = createLogger('inventory')

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
  static async list(db: DB, merchantId: string, q: { page?: string; limit?: string; search?: string; status?: string }) {
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

  static async lowStock(db: DB, merchantId: string, q: { page?: string; limit?: string }) {
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

  static async outOfStock(db: DB, merchantId: string, q: { page?: string; limit?: string }) {
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
    db: DB,
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

  /**
   * Inventory valuation: every variant valued at its parent product's cost
   * (productVariants carry no cost column — product cost is the fallback, 0
   * when unset). Returns line-level rows plus merchant totals.
   */
  static async valuation(db: DB, merchantId: string) {
    const rows = await db
      .select({
        variantId: productVariants.id,
        productId: products.id,
        productName: products.name,
        productSku: products.sku,
        sku: productVariants.sku,
        optionValues: productVariants.optionValues,
        inventory: productVariants.inventory,
        unitCost: products.cost
      })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(eq(products.merchantId, merchantId))
      .orderBy(desc(products.name))

    const items = rows.map((r) => {
      const unitCost = Number(r.unitCost ?? 0)
      return { ...r, unitCost, lineValue: r.inventory * unitCost }
    })
    const unitCount = items.reduce((sum, i) => sum + i.inventory, 0)
    const totalValue = items.reduce((sum, i) => sum + i.lineValue, 0)
    return ok({ items, skuCount: items.length, unitCount, totalValue })
  }

  /**
   * Low-stock alert hook. Call AFTER a decrement commits (checkout sale,
   * manual adjust, production consumption): when the new level is at or
   * below the product's threshold (or zero), emails the merchant owner once
   * per variant per day. Throttle marker is an `inventoryLogs` row with
   * reason 'low_stock_alert' (change 0) — no extra table, no in-memory
   * state. Never throws: alerts must not break the sale that triggered them.
   */
  static async maybeAlertLowStock(
    db: DB,
    merchantId: string,
    variantId: string,
    afterValue?: number
  ): Promise<void> {
    try {
      const [row] = await db
        .select({
          inventory: productVariants.inventory,
          unlimited: productVariants.unlimited,
          sku: productVariants.sku,
          optionValues: productVariants.optionValues,
          productName: products.name,
          threshold: products.lowStockThreshold,
          trackInventory: products.trackInventory
        })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(and(eq(productVariants.id, variantId), eq(products.merchantId, merchantId)))
      if (!row || row.unlimited) return
      const level = afterValue ?? row.inventory
      if (level > row.threshold) return

      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const [recent] = await db
        .select({ id: inventoryLogs.id })
        .from(inventoryLogs)
        .where(
          and(
            eq(inventoryLogs.merchantId, merchantId),
            eq(inventoryLogs.variantId, variantId),
            eq(inventoryLogs.reason, 'low_stock_alert'),
            gte(inventoryLogs.createdAt, dayAgo)
          )
        )
        .limit(1)
      if (recent) return

      const [identity] = await db
        .select({
          email: merchants.email,
          merchantName: merchants.name,
          fromEmail: notificationSettings.fromEmail,
          fromName: notificationSettings.fromName,
          enabled: notificationSettings.enabled
        })
        .from(merchants)
        .leftJoin(notificationSettings, eq(notificationSettings.merchantId, merchants.id))
        .where(eq(merchants.id, merchantId))
      if (!identity || identity.enabled === false) return
      const to = identity.email
      if (!to) return
      const storeName = identity.fromName ?? identity.merchantName
      const fromEmail = identity.fromEmail ?? process.env.MAIL_FROM_FALLBACK ?? 'onboarding@resend.dev'

      const variantLabel = row.sku ?? 'No SKU'
      const options = Object.entries((row.optionValues ?? {}) as Record<string, string>)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')
      await getMailer().send({
        from: `${storeName} <${fromEmail}>`,
        to,
        subject:
          level === 0
            ? `Out of stock: ${row.productName} (${variantLabel})`
            : `Low stock: ${row.productName} (${variantLabel}) — ${level} left`,
        html: renderEmail({
          title: level === 0 ? 'Variant out of stock' : 'Variant running low',
          intro:
            level === 0
              ? `${row.productName} is now out of stock. Restock it to keep selling.`
              : `${row.productName} dropped to ${level} units (threshold ${row.threshold}). Consider restocking.`,
          storeName,
          lines: [
            { label: 'Product', value: row.productName },
            ...(options ? [{ label: 'Options', value: options }] : []),
            { label: 'Variant SKU', value: variantLabel },
            { label: 'Stock on hand', value: String(level) },
            { label: 'Threshold', value: String(row.threshold) }
          ]
        })
      })

      await db.insert(inventoryLogs).values({
        merchantId,
        variantId,
        change: 0,
        beforeValue: level,
        afterValue: level,
        reason: 'low_stock_alert',
        reference: 'auto'
      })
    } catch (e) {
      log.error('low-stock alert failed', e)
    }
  }

  static async adjust(db: DB, merchantId: string, variantId: string, input: { change: number; reason: string }) {
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

    emit(merchantId, 'inventory.updated', {
      variantId,
      change: input.change,
      afterValue: result.updated.inventory,
      reason: input.reason
    })
    if (input.change < 0) {
      await this.maybeAlertLowStock(db, merchantId, variantId, result.updated.inventory)
    }
    return ok({ variant: result.updated, log: result.log })
  }
}
