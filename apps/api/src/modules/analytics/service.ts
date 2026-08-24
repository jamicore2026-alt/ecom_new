import { and, count, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { db } from '../../database/client'
import {
  categories,
  customers,
  orderItems,
  orders,
  products,
  publicCustomerColumns,
  refunds,
  visits
} from '../../database/schema'
import { ok } from '../../shared/response'
import { revenueStatuses } from '../../shared/types'

const round2 = (n: number) => Number(n.toFixed(2))

const parseRange = (from?: string, to?: string, days = 30) => {
  let end = to ? new Date(to) : new Date()
  if (isNaN(end.getTime())) end = new Date()
  end.setHours(23, 59, 59, 999)
  let start = from ? new Date(from) : new Date(end.getTime() - (days - 1) * 86400000)
  if (isNaN(start.getTime())) start = new Date(end.getTime() - (days - 1) * 86400000)
  start.setHours(0, 0, 0, 0)
  // An inverted range would silently return empty data — normalize instead.
  if (start > end) [start, end] = [end, start]
  return { start, end }
}

interface Query {
  from?: string
  to?: string
  interval?: string
}

export class AnalyticsService {
  /* --------------------------------- sales -------------------------------- */

  static async sales(merchantId: string, q: Query) {
    const { start, end } = parseRange(q.from, q.to)
    const interval = q.interval ?? 'day'
    const length = end.getTime() - start.getTime()
    const prevStart = new Date(start.getTime() - length)
    const prevEnd = new Date(start.getTime() - 1)

    const inRange = (s: Date, e: Date) =>
      and(
        eq(orders.merchantId, merchantId),
        inArray(orders.status, revenueStatuses),
        gte(orders.createdAt, s),
        lte(orders.createdAt, e)
      )

    const truncExpr = sql.raw(`date_trunc('${interval}', "orders"."created_at") at time zone 'UTC'`)
    const run = async (s: Date, e: Date) => {
      const buckets = await db
        .select({
          bucket: sql<string>`to_char(${truncExpr}, 'YYYY-MM-DD')`,
          revenue: sql<number>`coalesce(sum(${orders.total}), 0)`,
          ordersCount: sql<number>`count(*)`
        })
        .from(orders)
        .where(inRange(s, e))
        .groupBy(truncExpr)
        .orderBy(truncExpr)

      const [totals] = await db
        .select({
          revenue: sql<number>`coalesce(sum(${orders.total}), 0)`,
          ordersCount: sql<number>`count(*)`
        })
        .from(orders)
        .where(inRange(s, e))

      const [refundTotals] = await db
        .select({ total: sql<number>`coalesce(sum(${refunds.amount}), 0)` })
        .from(refunds)
        .where(and(eq(refunds.merchantId, merchantId), gte(refunds.createdAt, s), lte(refunds.createdAt, e)))

      return {
        series: buckets.map((b) => ({
          date: b.bucket,
          revenue: Number(b.revenue),
          orders: Number(b.ordersCount)
        })),
        revenue: Number(totals?.revenue ?? 0),
        orders: Number(totals?.ordersCount ?? 0),
        refunds: Number(refundTotals?.total ?? 0)
      }
    }

    const current = await run(start, end)
    const previous = await run(prevStart, prevEnd)

    const aov = current.orders > 0 ? current.revenue / current.orders : 0
    const pct = (curr: number, prev: number) =>
      prev > 0 ? Number((((curr - prev) / prev) * 100).toFixed(1)) : 0

    return ok({
      ...current,
      aov: round2(aov),
      netRevenue: round2(current.revenue - current.refunds),
      interval,
      from: start.toISOString(),
      to: end.toISOString(),
      comparison: {
        previous: { ...previous, aov: round2(previous.orders > 0 ? previous.revenue / previous.orders : 0) },
        revenueDeltaPct: pct(current.revenue, previous.revenue),
        ordersDeltaPct: pct(current.orders, previous.orders)
      }
    })
  }

  /* -------------------------------- products ------------------------------ */

  static async products(merchantId: string, q: Query) {
    const { start, end } = parseRange(q.from, q.to)

    const itemFilter = and(
      eq(products.merchantId, merchantId),
      inArray(orders.status, revenueStatuses),
      gte(orders.createdAt, start),
      lte(orders.createdAt, end)
    )

    const top = await db
      .select({
        productId: products.id,
        name: products.name,
        sku: products.sku,
        revenue: sql<number>`coalesce(sum(${orderItems.total}), 0)`,
        quantity: sql<number>`coalesce(sum(${orderItems.quantity}), 0)`,
        ordersCount: sql<number>`count(distinct ${orderItems.orderId})`
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(itemFilter)
      .groupBy(products.id)
      .orderBy(sql`coalesce(sum(${orderItems.total}), 0) desc`)
      .limit(10)

    const categoryBreakdown = await db
      .select({
        categoryId: categories.id,
        categoryName: categories.name,
        revenue: sql<number>`coalesce(sum(${orderItems.total}), 0)`,
        quantity: sql<number>`coalesce(sum(${orderItems.quantity}), 0)`
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(itemFilter)
      .groupBy(categories.id)
      .orderBy(sql`coalesce(sum(${orderItems.total}), 0) desc`)

    // Only orders inside the requested window count — otherwise "low performers"
    // is dominated by products that simply haven't sold in the range.
    const lowPerformers = await db
      .select({
        productId: products.id,
        name: products.name,
        sku: products.sku,
        revenue: sql<number>`coalesce(sum(${orderItems.total}), 0)`,
        quantity: sql<number>`coalesce(sum(${orderItems.quantity}), 0)`
      })
      .from(products)
      .leftJoin(
        orderItems,
        and(
          eq(orderItems.productId, products.id),
          inArray(
            orderItems.orderId,
            db
              .select({ id: orders.id })
              .from(orders)
              .where(
                and(
                  eq(orders.merchantId, merchantId),
                  gte(orders.createdAt, start),
                  lte(orders.createdAt, end),
                  inArray(orders.status, revenueStatuses)
                )
              )
          )
        )
      )
      .where(eq(products.merchantId, merchantId))
      .groupBy(products.id)
      .orderBy(sql`coalesce(sum(${orderItems.total}), 0) asc`)
      .limit(10)

    return ok({
      top,
      categoryBreakdown,
      lowPerformers,
      totalProducts: await this.countProducts(merchantId)
    })
  }

  private static async countProducts(merchantId: string) {
    const [row] = await db
      .select({ total: count() })
      .from(products)
      .where(eq(products.merchantId, merchantId))
    return Number(row?.total ?? 0)
  }

  /* -------------------------------- customers ------------------------------ */

  static async customers(merchantId: string, q: Query) {
    const { start, end } = parseRange(q.from, q.to)

    const [newRow] = await db
      .select({ total: count() })
      .from(customers)
      .where(
        and(eq(customers.merchantId, merchantId), gte(customers.createdAt, start), lte(customers.createdAt, end))
      )

    const activeOrders = await db
      .selectDistinct({ customerId: orders.customerId })
      .from(orders)
      .where(
        and(eq(orders.merchantId, merchantId), gte(orders.createdAt, start), lte(orders.createdAt, end))
      )

    const activeCustomerIds = activeOrders
      .map((r) => r.customerId)
      .filter((v): v is string => !!v)
    const newCount = Number(newRow?.total ?? 0)
    const returningCount = Math.max(0, activeCustomerIds.length - newCount)

    const [repeatRow] = await db
      .select({
        repeat: sql<number>`count(*) filter (where ${customers.ordersCount} >= 2)`,
        ordered: sql<number>`count(*) filter (where ${customers.ordersCount} >= 1)`
      })
      .from(customers)
      .where(eq(customers.merchantId, merchantId))

    const monthlyTrunc = sql.raw(`date_trunc('month', "customers"."created_at")`)
    const monthly = await db
      .select({
        month: sql<string>`to_char(${monthlyTrunc} at time zone 'UTC', 'YYYY-MM')`,
        count: count()
      })
      .from(customers)
      .where(
        and(eq(customers.merchantId, merchantId), gte(customers.createdAt, start), lte(customers.createdAt, end))
      )
      .groupBy(monthlyTrunc)
      .orderBy(monthlyTrunc)

    const topSpenders = await db
      .select(publicCustomerColumns)
      .from(customers)
      .where(eq(customers.merchantId, merchantId))
      .orderBy(sql`${customers.totalSpent} desc`)
      .limit(10)

    const ordered = Number(repeatRow?.ordered ?? 0)
    return ok({
      newCustomers: newCount,
      activeCustomers: activeCustomerIds.length,
      returningCustomers: returningCount,
      repeatPurchaseRate: ordered > 0 ? round2(((Number(repeatRow?.repeat ?? 0) / ordered) * 100)) : 0,
      monthlyNewCustomers: monthly.map((m) => ({ month: m.month, count: Number(m.count) })),
      topSpenders,
      from: start.toISOString(),
      to: end.toISOString()
    })
  }

  /* ------------------------------- conversion ------------------------------ */

  static async conversion(merchantId: string, q: Query) {
    const { start, end } = parseRange(q.from, q.to)
    const length = end.getTime() - start.getTime()
    const prevStart = new Date(start.getTime() - length)
    const prevEnd = new Date(start.getTime() - 1)

    const run = async (s: Date, e: Date) => {
      const [totals] = await db
        .select({
          views: sql<number>`coalesce(sum(${visits.views}), 0)`,
          cartAdds: sql<number>`coalesce(sum(${visits.cartAdds}), 0)`,
          checkouts: sql<number>`coalesce(sum(${visits.checkouts}), 0)`,
          paid: sql<number>`coalesce(sum(${visits.paid}), 0)`
        })
        .from(visits)
        .where(and(eq(visits.merchantId, merchantId), gte(visits.date, s), lte(visits.date, e)))

      const byChannel = await db
        .select({
          channel: visits.channel,
          views: sql<number>`coalesce(sum(${visits.views}), 0)`,
          cartAdds: sql<number>`coalesce(sum(${visits.cartAdds}), 0)`,
          checkouts: sql<number>`coalesce(sum(${visits.checkouts}), 0)`,
          paid: sql<number>`coalesce(sum(${visits.paid}), 0)`
        })
        .from(visits)
        .where(and(eq(visits.merchantId, merchantId), gte(visits.date, s), lte(visits.date, e)))
        .groupBy(visits.channel)

      const views = Number(totals?.views ?? 0)
      const cartAdds = Number(totals?.cartAdds ?? 0)
      const checkouts = Number(totals?.checkouts ?? 0)
      const paid = Number(totals?.paid ?? 0)
      const rate = (a: number, b: number) => (b > 0 ? round2((a / b) * 100) : 0)

      return {
        views,
        cartAdds,
        checkouts,
        paid,
        conversionRate: rate(paid, views),
        funnel: {
          viewToCart: rate(cartAdds, views),
          cartToCheckout: rate(checkouts, cartAdds),
          checkoutToPaid: rate(paid, checkouts)
        },
        byChannel: byChannel.map((c) => ({
          channel: c.channel,
          views: Number(c.views),
          cartAdds: Number(c.cartAdds),
          checkouts: Number(c.checkouts),
          paid: Number(c.paid),
          conversionRate: rate(Number(c.paid), Number(c.views))
        }))
      }
    }

    const current = await run(start, end)
    const previous = await run(prevStart, prevEnd)
    const delta = (c: number, p: number) => (p > 0 ? Number((((c - p) / p) * 100).toFixed(1)) : 0)

    return ok({
      ...current,
      from: start.toISOString(),
      to: end.toISOString(),
      comparison: {
        previous: { conversionRate: previous.conversionRate },
        conversionDeltaPct: delta(current.conversionRate, previous.conversionRate),
        viewsDeltaPct: delta(current.views, previous.views)
      }
    })
  }
}
