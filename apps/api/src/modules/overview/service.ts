import { and, count, eq, gte, gt, inArray, lte, sql } from 'drizzle-orm'
import type { DB } from '../../database/client'
import {
  customers,
  merchants,
  orderItems,
  orders,
  products,
  productVariants
} from '../../database/schema'
import { ok } from '../../shared/response'
import { netRevenue, netRevenueByDay, PAID_PAYMENT_STATUSES } from '../../shared/revenue'
import { branchOrderCondition } from '../../shared/outlet-scope'

// UTC-consistent day buckets — the visits funnel (analytics) and provider
// webhooks all operate in UTC, so local-server day keys would misalign charts.
const dayKey = (d: Date) => d.toISOString().slice(0, 10)

const startOfUtcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
const startOfToday = () => startOfUtcDay(new Date())
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000)

export class OverviewService {
  static async dashboard(db: DB, merchantId: string, branchIds: string[] | null = null) {
    const [merchant] = await db
      .select({ currency: merchants.currency })
      .from(merchants)
      .where(eq(merchants.id, merchantId))
    const currency = merchant?.currency ?? 'USD'
    const scope = branchOrderCondition(branchIds)

    const today = startOfToday()
    const start30 = daysAgo(29)
    const [todayKey] = [dayKey(today)]

    const todaySales = await netRevenue(db, merchantId, today, branchIds)

    const [ordersTodayRow] = await db
      .select({ count: count() })
      .from(orders)
      .where(
        and(
          eq(orders.merchantId, merchantId),
          gte(orders.createdAt, today),
          ...(scope ? [scope] : [])
        )
      )

    const [pendingRow] = await db
      .select({ count: count() })
      .from(orders)
      .where(
        and(
          eq(orders.merchantId, merchantId),
          eq(orders.status, 'pending'),
          ...(scope ? [scope] : [])
        )
      )

    const [rangeRow] = await db
      .select({
        ordersCount: sql<number>`count(*)`
      })
      .from(orders)
      .where(
        and(
          eq(orders.merchantId, merchantId),
          inArray(orders.paymentStatus, PAID_PAYMENT_STATUSES),
          gte(orders.createdAt, start30),
          ...(scope ? [scope] : [])
        )
      )

    const [lowStockRow] = await db
      .select({ count: count() })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(
        and(
          eq(products.merchantId, merchantId),
          gt(productVariants.inventory, 0),
          lte(productVariants.inventory, products.lowStockThreshold)
        )
      )

    const [outOfStockRow] = await db
      .select({ count: count() })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(and(eq(products.merchantId, merchantId), eq(productVariants.inventory, 0)))

    // Paid order COUNT per day (revenue comes from netRevenueByDay above).
    const chartRowsRaw = await db
      .select({
        day: sql<string>`to_char(${orders.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        ordersCount: sql<number>`count(*)`
      })
      .from(orders)
      .where(
        and(
          eq(orders.merchantId, merchantId),
          inArray(orders.paymentStatus, PAID_PAYMENT_STATUSES),
          gte(orders.createdAt, start30),
          ...(scope ? [scope] : [])
        )
      )
      .groupBy(sql`to_char(${orders.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`)

    const chartMap = new Map(await netRevenueByDay(db, merchantId, start30, branchIds))
    const countMap = new Map(
      chartRowsRaw.map((r) => [r.day, Number(r.ordersCount ?? 0)])
    )
    const salesChart = Array.from({ length: 30 }, (_, i) => {
      const date = new Date(Date.now() - (29 - i) * 86400000)
      const key = dayKey(date)
      return {
        date: key,
        revenue: Number(chartMap.get(key) ?? 0),
        orders: Number(countMap.get(key) ?? 0)
      }
    })

    const recentOrders = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
        total: orders.total,
        currency: orders.currency,
        createdAt: orders.createdAt,
        customerName: sql<string>`concat_ws(' ', ${customers.firstName}, ${customers.lastName})`,
        customerEmail: customers.email
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(
        and(
          eq(orders.merchantId, merchantId),
          ...(scope ? [scope] : [])
        )
      )
      .orderBy(sql`${orders.createdAt} desc`)
      .limit(10)

    const topProducts = await db
      .select({
        productId: products.id,
        name: products.name,
        revenue: sql<number>`coalesce(sum(${orderItems.total}), 0)`,
        quantity: sql<number>`coalesce(sum(${orderItems.quantity}), 0)`
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(
        and(
          eq(products.merchantId, merchantId),
          inArray(orders.paymentStatus, PAID_PAYMENT_STATUSES),
          ...(scope ? [scope] : [])
        )
      )
      .groupBy(products.id)
      .orderBy(sql`coalesce(sum(${orderItems.total}), 0) desc`)
      .limit(5)

    const avgOrderValue =
      Number(rangeRow?.ordersCount ?? 0) > 0
        ? (await netRevenue(db, merchantId, start30, branchIds)) / Number(rangeRow?.ordersCount ?? 0)
        : 0

    return ok({
      todaySales,
      ordersToday: Number(ordersTodayRow?.count ?? 0),
      avgOrderValue: Number(avgOrderValue.toFixed(2)),
      pendingOrders: Number(pendingRow?.count ?? 0),
      lowStockCount: Number(lowStockRow?.count ?? 0),
      outOfStockCount: Number(outOfStockRow?.count ?? 0),
      salesChart,
      recentOrders,
      topProducts,
      currency,
      todayKey
    })
  }
}
