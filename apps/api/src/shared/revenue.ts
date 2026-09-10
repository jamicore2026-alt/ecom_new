import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { db } from '../database/client'
import { orders, refunds } from '../database/schema'
import { branchOrderCondition } from './outlet-scope'

/**
 * Payment states that mean money was actually collected for an order.
 *
 * `partially_refunded` / `refunded` orders STILL count toward gross revenue —
 * the refunded portion is netted out via `refunds(status = 'completed')`, so a
 * fully refunded order nets to zero instead of silently vanishing (and a
 * partially refunded order keeps its un-refunded revenue).
 *
 * Never filter revenue by order.status / `revenueStatuses`: that mix includes
 * unpaid pending orders (which have collected nothing) and excludes refunded
 * orders (which must be netted, not dropped).
 */
export const PAID_PAYMENT_STATUSES = ['paid', 'partially_refunded', 'refunded'] as const

// Completed refunds, followed by their orders in the aggregate queries below.
const completedRefundJoin = (merchantId: string) =>
  and(
    eq(refunds.orderId, orders.id),
    eq(refunds.merchantId, merchantId),
    eq(refunds.status, 'completed')
  )

const inWindow = (merchantId: string, since: Date, branchIds: string[] | null = null) => {
  const scope = branchOrderCondition(branchIds)
  return and(
    eq(orders.merchantId, merchantId),
    inArray(orders.paymentStatus, PAID_PAYMENT_STATUSES),
    gte(orders.createdAt, since),
    ...(scope ? [scope] : [])
  )
}

/** Net revenue in a window: collected order totals minus completed refunds. */
export async function netRevenue(
  merchantId: string,
  since: Date,
  branchIds: string[] | null = null
): Promise<number> {
  const [row] = await db
    .select({
      revenue: sql<number>`coalesce(sum(${orders.total}), 0) - coalesce(sum(${refunds.amount}), 0)`
    })
    .from(orders)
    .leftJoin(refunds, completedRefundJoin(merchantId))
    .where(inWindow(merchantId, since, branchIds))
  return Number(row?.revenue ?? 0)
}

/**
 * Net revenue bucketed by the ORDER's UTC day. Refunds are netted into the day
 * the order was created, so a returned order doesn't show one revenue day and a
 * separate refund day in the same series.
 */
export async function netRevenueByDay(
  merchantId: string,
  since: Date,
  branchIds: string[] | null = null
): Promise<Map<string, number>> {
  const dayCol = sql<string>`to_char(${orders.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`
  const rows = await db
    .select({
      day: dayCol,
      revenue: sql<number>`coalesce(sum(${orders.total}), 0) - coalesce(sum(${refunds.amount}), 0)`
    })
    .from(orders)
    .leftJoin(refunds, completedRefundJoin(merchantId))
    .where(inWindow(merchantId, since, branchIds))
    .groupBy(dayCol)
  return new Map(rows.map((r) => [r.day, Number(r.revenue ?? 0)]))
}