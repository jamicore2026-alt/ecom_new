import { and, eq, sql } from 'drizzle-orm'
import { db } from '../database/client'
import {
  coupons,
  inventoryLogs,
  orderItems,
  orders,
  productVariants,
  returnsTable
} from '../database/schema'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type OrderRow = typeof orders.$inferSelect

/**
 * The ONE authoritative cancellation operation for pending unpaid orders.
 *
 * Every cancellation path (storefront expiry sweep, provider-session failure,
 * merchant dashboard cancel) must route through here so they all perform the
 * identical business operations atomically:
 *
 *   1. Conditional status claim — pending+unpaid → cancelled+failed, so only
 *      one racing path (sweep / webhook / staff action) can win.
 *   2. Inventory restoration — variants locked FOR UPDATE, relative increment,
 *      minus units already restocked by approved returns.
 *   3. Coupon quota restore — greatest(usedCount - 1, 0).
 *
 * Returns false when another path already resolved the order.
 */
export const cancelPendingOrderTx = async (
  tx: Tx,
  order: OrderRow,
  opts: { reason?: string } = {}
): Promise<boolean> => {
  const [claimed] = await tx
    .update(orders)
    .set({
      status: 'cancelled',
      paymentStatus: 'failed',
      fulfillmentStatus: 'unfulfilled',
      expiresAt: null,
      updatedAt: new Date()
    })
    .where(
      and(
        eq(orders.id, order.id),
        eq(orders.status, 'pending'),
        eq(orders.paymentStatus, 'unpaid')
      )
    )
    .returning({ id: orders.id })
  if (!claimed) return false

  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id))

  // Approved returns already restocked their units — don't double-restock them.
  const approvedRows = await tx
    .select({
      orderItemId: returnsTable.orderItemId,
      returned: sql<number>`coalesce(sum(${returnsTable.quantity}), 0)`
    })
    .from(returnsTable)
    .where(and(eq(returnsTable.orderId, order.id), eq(returnsTable.status, 'approved')))
    .groupBy(returnsTable.orderItemId)
  const approvedByItem = new Map(
    approvedRows.map((r) => [r.orderItemId, Number(r.returned)])
  )

  for (const item of items) {
    if (!item.variantId) continue
    const quantity = Math.max(0, item.quantity - (approvedByItem.get(item.id) ?? 0))
    if (quantity === 0) continue
    const [variant] = await tx
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, item.variantId))
      .for('update')
    if (!variant) continue
    const afterValue = variant.inventory + quantity
    await tx
      .update(productVariants)
      .set({ inventory: afterValue })
      .where(eq(productVariants.id, variant.id))
    await tx.insert(inventoryLogs).values({
      merchantId: order.merchantId,
      variantId: variant.id,
      change: quantity,
      beforeValue: variant.inventory,
      afterValue,
      reason: opts.reason ?? 'cancel',
      reference: order.orderNumber
    })
  }

  if (order.couponCode) {
    await tx
      .update(coupons)
      .set({ usedCount: sql`greatest(${coupons.usedCount} - 1, 0)` })
      .where(and(eq(coupons.merchantId, order.merchantId), eq(coupons.code, order.couponCode)))
  }

  return true
}

/** Standalone runner for paths that don't already hold a transaction. */
export const runCancelPendingOrder = async (
  order: OrderRow,
  opts: { reason?: string } = {}
): Promise<boolean> => db.transaction((tx) => cancelPendingOrderTx(tx, order, opts))
