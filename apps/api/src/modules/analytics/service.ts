import { and, count, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import type { DB } from '../../database/client'
import {
  categories,
  customers,
  orderItems,
  orders,
  products,
  publicCustomerColumns,
  refunds,
  returnsTable,
  visits
} from '../../database/schema'
import { ok } from '../../shared/response'
import { PAID_PAYMENT_STATUSES } from '../../shared/revenue'
import { branchOrderCondition } from '../../shared/outlet-scope'

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

type AnalyticsInterval = 'day' | 'week' | 'month'

/**
 * Honest bucket caption format for to_char(): weekly buckets are anchored on
 * the Monday 00:00 UTC that starts the ISO week, so a bare "YYYY-MM-DD"
 * reads as a single day. Week grain is labelled "Week of YYYY-MM-DD";
 * day/month grains keep their plain date formats.
 */
export const bucketFormatFor = (interval: AnalyticsInterval): string =>
  interval === 'week' ? '"Week of "YYYY-MM-DD' : interval === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD'

interface Query {
  from?: string
  to?: string
  interval?: AnalyticsInterval
}

// Keep SQL fragments fully internal. Never interpolate request-derived values into sql.raw().
const intervalTruncExpressions: Record<AnalyticsInterval, ReturnType<typeof sql.raw>> = {
  day: sql.raw(`date_trunc('day', "orders"."created_at") at time zone 'UTC'`),
  week: sql.raw(`date_trunc('week', "orders"."created_at") at time zone 'UTC'`),
  month: sql.raw(`date_trunc('month', "orders"."created_at") at time zone 'UTC'`)
}

export class AnalyticsService {
  /* --------------------------------- sales -------------------------------- */

  static async sales(db: DB, merchantId: string, q: Query, branchIds: string[] | null = null) {
    const { start, end } = parseRange(q.from, q.to)
    const interval: AnalyticsInterval = q.interval ?? 'day'
    const length = end.getTime() - start.getTime()
    const prevStart = new Date(start.getTime() - length)
    const prevEnd = new Date(start.getTime() - 1)
    const scope = branchOrderCondition(branchIds)

    const inRange = (s: Date, e: Date) =>
      and(
        eq(orders.merchantId, merchantId),
        inArray(orders.paymentStatus, PAID_PAYMENT_STATUSES),
        gte(orders.createdAt, s),
        lte(orders.createdAt, e),
        ...(scope ? [scope] : [])
      )

    const refundFilter = (s: Date, e: Date) =>
      and(
        eq(refunds.merchantId, merchantId),
        eq(refunds.status, 'completed'),
        gte(refunds.createdAt, s),
        lte(refunds.createdAt, e),
        ...(scope ? [scope] : [])
      )

    const truncExpr = intervalTruncExpressions[interval]
    // Honest bucket labels: date_trunc('week') yields the Monday 00:00 UTC
    // that starts the ISO week, so labelling it a bare "YYYY-MM-DD" misleads
    // readers into seeing a single day. `date` keeps the machine-sortable
    // bucket start (backward compatible for charts/CSV); `label` is the
    // human-honest caption ("Week of 2026-09-21", month grain stays YYYY-MM).
    const bucketFormat = bucketFormatFor(interval)
    const run = async (s: Date, e: Date) => {
      const buckets = await db
        .select({
          bucket: sql<string>`to_char(${truncExpr}, 'YYYY-MM-DD')`,
          label: sql<string>`to_char(${truncExpr}, ${bucketFormat})`,
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
        .innerJoin(orders, eq(refunds.orderId, orders.id))
        .where(refundFilter(s, e))

      return {
        series: buckets.map((b) => ({
          date: b.bucket,
          label: b.label,
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

  static async products(db: DB, merchantId: string, q: Query, branchIds: string[] | null = null) {
    const { start, end } = parseRange(q.from, q.to)
    const scope = branchOrderCondition(branchIds)

    const itemFilter = and(
      eq(products.merchantId, merchantId),
      inArray(orders.paymentStatus, PAID_PAYMENT_STATUSES),
      gte(orders.createdAt, start),
      lte(orders.createdAt, end),
      ...(scope ? [scope] : [])
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
                  inArray(orders.paymentStatus, PAID_PAYMENT_STATUSES),
                  ...(scope ? [scope] : [])
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
      totalProducts: await this.countProducts(db, merchantId)
    })
  }

  private static async countProducts(db: DB, merchantId: string) {
    const [row] = await db
      .select({ total: count() })
      .from(products)
      .where(eq(products.merchantId, merchantId))
    return Number(row?.total ?? 0)
  }

  /* -------------------------------- customers ------------------------------ */

  static async customers(db: DB, merchantId: string, q: Query, branchIds: string[] | null = null) {
    const { start, end } = parseRange(q.from, q.to)
    const scope = branchOrderCondition(branchIds)

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
        and(
          eq(orders.merchantId, merchantId),
          gte(orders.createdAt, start),
          lte(orders.createdAt, end),
          ...(scope ? [scope] : [])
        )
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

  static async conversion(db: DB, merchantId: string, q: Query, branchIds: string[] | null = null) {
    const { start, end } = parseRange(q.from, q.to)
    const length = end.getTime() - start.getTime()
    const prevStart = new Date(start.getTime() - length)
    const prevEnd = new Date(start.getTime() - 1)
    // NOTE (outlet scope): the visits funnel is merchant-level aggregates
    // (visits has no outlet column), so funnel/byChannel stay merchant-wide.
    // Everything order-derived below IS branch-scoped via branchOrderCondition.

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

    // Cart/checkout abandonment from the same funnel counters.
    const abandon = (started: number, finished: number) =>
      started > 0 ? round2(((started - finished) / started) * 100) : 0
    // Order-derived, branch-scoped channel revenue for this window.
    const revenueByChannel = await this.channelRevenue(db, merchantId, start, end, branchIds)

    return ok({
      ...current,
      abandonment: {
        cartAbandonmentRate: abandon(current.cartAdds, current.paid),
        checkoutAbandonmentRate: abandon(current.checkouts, current.paid)
      },
      revenueByChannel,
      from: start.toISOString(),
      to: end.toISOString(),
      comparison: {
        previous: { conversionRate: previous.conversionRate },
        conversionDeltaPct: delta(current.conversionRate, previous.conversionRate),
        viewsDeltaPct: delta(current.views, previous.views)
      }
    })
  }

  /* --------------------------- revenue by channel -------------------------- */

  private static async channelRevenue(
    db: DB,
    merchantId: string,
    start: Date,
    end: Date,
    branchIds: string[] | null = null
  ) {
    const scope = branchOrderCondition(branchIds)
    const rows = await db
      .select({
        channel: orders.attributionChannel,
        revenue: sql<number>`coalesce(sum(${orders.total}), 0)`,
        ordersCount: sql<number>`count(*)`
      })
      .from(orders)
      .where(
        and(
          eq(orders.merchantId, merchantId),
          inArray(orders.paymentStatus, PAID_PAYMENT_STATUSES),
          gte(orders.createdAt, start),
          lte(orders.createdAt, end),
          ...(scope ? [scope] : [])
        )
      )
      .groupBy(orders.attributionChannel)
      .orderBy(sql`coalesce(sum(${orders.total}), 0) desc`)
    return rows.map((r) => ({
      channel: r.channel ?? 'direct',
      revenue: Number(r.revenue),
      orders: Number(r.ordersCount)
    }))
  }

  /** Revenue split by attribution channel (branch-scoped, order-derived). */
  static async channels(db: DB, merchantId: string, q: Query, branchIds: string[] | null = null) {
    const { start, end } = parseRange(q.from, q.to)
    return ok({
      channels: await this.channelRevenue(db, merchantId, start, end, branchIds),
      from: start.toISOString(),
      to: end.toISOString()
    })
  }

  /* ---------------------------------- CLV ---------------------------------- */

  /**
   * Average customer lifetime value = mean totalSpent over customers with at
   * least one order. NOTE: customers carry no outlet column, so CLV is
   * merchant-wide even when a branch scope is passed (documented).
   */
  static async clv(db: DB, merchantId: string, _q: Query, _branchIds: string[] | null = null) {
    const [row] = await db
      .select({
        avg: sql<number>`coalesce(avg(${customers.totalSpent}), 0)`,
        count: sql<number>`count(*)`
      })
      .from(customers)
      .where(and(eq(customers.merchantId, merchantId), sql`${customers.ordersCount} >= 1`))
    const average = Number(row?.avg ?? 0)
    return ok({
      averageClv: round2(average),
      customersWithOrders: Number(row?.count ?? 0)
    })
  }

  /* ------------------------------ refund / return --------------------------- */

  /** Refund + return rates over paid orders in range (branch-scoped). */
  static async refundRates(db: DB, merchantId: string, q: Query, branchIds: string[] | null = null) {
    const { start, end } = parseRange(q.from, q.to)
    const scope = branchOrderCondition(branchIds)
    const orderFilter = and(
      eq(orders.merchantId, merchantId),
      inArray(orders.paymentStatus, PAID_PAYMENT_STATUSES),
      gte(orders.createdAt, start),
      lte(orders.createdAt, end),
      ...(scope ? [scope] : [])
    )
    const [paidRow] = await db
      .select({ count: sql<number>`count(*)`, revenue: sql<number>`coalesce(sum(${orders.total}), 0)` })
      .from(orders)
      .where(orderFilter)
    const paidCount = Number(paidRow?.count ?? 0)

    const [refundRow] = await db
      .select({
        ordersRefunded: sql<number>`count(distinct ${refunds.orderId})`,
        amount: sql<number>`coalesce(sum(${refunds.amount}), 0)`
      })
      .from(refunds)
      .innerJoin(orders, eq(refunds.orderId, orders.id))
      .where(
        and(
          eq(refunds.merchantId, merchantId),
          eq(refunds.status, 'completed'),
          gte(refunds.createdAt, start),
          lte(refunds.createdAt, end),
          ...(scope ? [scope] : [])
        )
      )

    const [returnRow] = await db
      .select({
        ordersReturned: sql<number>`count(distinct ${returnsTable.orderId})`,
        count: sql<number>`count(*)`
      })
      .from(returnsTable)
      .innerJoin(orders, eq(returnsTable.orderId, orders.id))
      .where(
        and(
          eq(returnsTable.merchantId, merchantId),
          gte(returnsTable.createdAt, start),
          lte(returnsTable.createdAt, end),
          ...(scope ? [scope] : [])
        )
      )

    const refundedOrders = Number(refundRow?.ordersRefunded ?? 0)
    const returnedOrders = Number(returnRow?.ordersReturned ?? 0)
    return ok({
      paidOrders: paidCount,
      paidRevenue: Number(paidRow?.revenue ?? 0),
      refundedOrders,
      refundAmount: Number(refundRow?.amount ?? 0),
      refundRate: paidCount > 0 ? round2((refundedOrders / paidCount) * 100) : 0,
      returnedOrders,
      totalReturns: Number(returnRow?.count ?? 0),
      returnRate: paidCount > 0 ? round2((returnedOrders / paidCount) * 100) : 0,
      from: start.toISOString(),
      to: end.toISOString()
    })
  }

  /* --------------------------------- cohorts -------------------------------- */

  /**
   * Signup-month cohorts: per month, signups + how many became repeat buyers
   * (ordersCount >= 2). NOTE: merchant-wide — customers carry no outlet
   * column (documented).
   */
  static async cohorts(db: DB, merchantId: string, q: Query) {
    const { start, end } = parseRange(q.from, q.to, 365)
    const monthTrunc = sql.raw(`date_trunc('month', "customers"."created_at")`)
    const rows = await db
      .select({
        month: sql<string>`to_char(${monthTrunc} at time zone 'UTC', 'YYYY-MM')`,
        signups: sql<number>`count(*)`,
        repeat: sql<number>`count(*) filter (where ${customers.ordersCount} >= 2)`
      })
      .from(customers)
      .where(
        and(eq(customers.merchantId, merchantId), gte(customers.createdAt, start), lte(customers.createdAt, end))
      )
      .groupBy(monthTrunc)
      .orderBy(monthTrunc)
    return ok({
      cohorts: rows.map((r) => {
        const signups = Number(r.signups)
        const repeat = Number(r.repeat)
        return {
          month: r.month,
          signups,
          repeatBuyers: repeat,
          repeatRate: signups > 0 ? round2((repeat / signups) * 100) : 0
        }
      }),
      from: start.toISOString(),
      to: end.toISOString()
    })
  }

  /* --------------------------------- export --------------------------------- */

  /** CSV export mirroring the JSON endpoints (branch-scoped where applicable). */
  static async exportCsv(
    db: DB,
    merchantId: string,
    type: string,
    q: Query,
    branchIds: string[] | null = null
  ): Promise<string> {
    const esc = (v: unknown) => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    };
    const toCsv = (headers: string[], rows: Array<Array<unknown>>) =>
      [headers.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n') + '\n'
    if (type === 'products') {
      const data = (await this.products(db, merchantId, q, branchIds)).data
      return toCsv(
        ['product_id', 'name', 'sku', 'revenue', 'quantity', 'orders'],
        data.top.map((p: { productId: string; name: string; sku: string | null; revenue: number; quantity: number; ordersCount: number }) =>
          [p.productId, p.name, p.sku ?? '', p.revenue, p.quantity, p.ordersCount])
      )
    }
    if (type === 'customers') {
      const data = (await this.customers(db, merchantId, q, branchIds)).data
      return toCsv(
        ['month', 'new_customers'],
        data.monthlyNewCustomers.map((m: { month: string; count: number }) => [m.month, m.count])
      )
    }
    if (type === 'conversion') {
      const data = (await this.conversion(db, merchantId, q, branchIds)).data
      return toCsv(
        ['channel', 'views', 'cart_adds', 'checkouts', 'paid', 'conversion_rate'],
        data.byChannel.map((c: { channel: string; views: number; cartAdds: number; checkouts: number; paid: number; conversionRate: number }) =>
          [c.channel, c.views, c.cartAdds, c.checkouts, c.paid, c.conversionRate])
      )
    }
    if (type === 'channels') {
      const data = (await this.channels(db, merchantId, q, branchIds)).data
      return toCsv(
        ['channel', 'revenue', 'orders'],
        data.channels.map((c: { channel: string; revenue: number; orders: number }) => [c.channel, c.revenue, c.orders])
      )
    }
    if (type === 'cohorts') {
      const data = (await this.cohorts(db, merchantId, q)).data
      return toCsv(
        ['month', 'signups', 'repeat_buyers', 'repeat_rate'],
        data.cohorts.map((c: { month: string; signups: number; repeatBuyers: number; repeatRate: number }) =>
          [c.month, c.signups, c.repeatBuyers, c.repeatRate])
      )
    }
    const data = (await this.sales(db, merchantId, q, branchIds)).data
    return toCsv(
      ['date', 'revenue', 'orders'],
      data.series.map((s: { date: string; revenue: number; orders: number }) => [s.date, s.revenue, s.orders])
    )
  }
}
