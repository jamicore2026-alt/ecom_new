import { and, eq, sql } from 'drizzle-orm'
import { db } from '../database/client'
import { customers, orders, visits } from '../database/schema'
import { badRequest } from './errors'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type OrderRow = typeof orders.$inferSelect

/**
 * Side effects of an unpaid→paid transition, inside the caller's transaction:
 * customer totals (relative increment — no lost updates) and the funnel `paid`
 * metric attributed to the checkout channel.
 */
export const markOrderPaidEffects = async (tx: Tx, merchantId: string, order: OrderRow) => {
  if (order.customerId) {
    await tx
      .update(customers)
      .set({
        totalSpent: sql`${customers.totalSpent} + ${Number(order.total)}`,
        lastOrderAt: order.createdAt
      })
      .where(eq(customers.id, order.customerId))
  }

  const channel = order.attributionChannel ?? 'direct'
  const now = new Date()
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  await tx
    .insert(visits)
    .values({ merchantId, date, channel, views: 0, cartAdds: 0, checkouts: 0, paid: 1 })
    .onConflictDoUpdate({
      target: [visits.merchantId, visits.date, visits.channel],
      set: { paid: sql`${visits.paid} + 1` }
    })
}

/**
 * Manual "mark paid" from the dashboard — enforces the same unpaid→paid-only
 * invariant as gateway payments so totals/emails/visits stay consistent.
 */
export const applyManualMarkPaid = async (
  order: OrderRow,
  extra: Partial<OrderRow> = {}
): Promise<OrderRow> =>
  db.transaction(async (tx) => {
    const flipped = await tx
      .update(orders)
      .set({ paymentStatus: 'paid', expiresAt: null, ...extra })
      .where(and(eq(orders.id, order.id), eq(orders.paymentStatus, 'unpaid')))
      .returning()
    if (flipped.length === 0) {
      throw badRequest('INVALID_TRANSITION', 'Order payment was already updated')
    }
    await markOrderPaidEffects(tx, order.merchantId, flipped[0])
    return flipped[0]
  })
