import { and, count, eq, gte, gt, inArray, lte, sql } from 'drizzle-orm'
import { db } from '../../database/client'
import {
  customers,
  merchants,
  orderItems,
  orders,
  products,
  productVariants
} from '../../database/schema'
import { ok } from '../../shared/response'
import { revenueStatuses } from '../../shared/types'

// UTC-consistent day buckets — the visits funnel (analytics) and provider
// webhooks all operate in UTC, so local-server day keys would misalign charts.
const dayKey = (d: Date) => d.toISOString().slice(0, 10)

const startOfUtcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
const startOfToday = () => startOfUtcDay(new Date())
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000)

export class OverviewService {
  static async dashboard(merchantId: string) {
    const [merchant] = await db
      .select({ currency: merchants.currency })
      .from(merchants)
      .where(eq(merchants.id, merchantId))
    const currency = merchant?.currency ?? 'USD'

    const today = startOfToday()
    const start30 = daysAgo(29)
    const [todayKey] = [dayKey(today)]

    const [todaySalesRow] = await db
      .select({ revenue: sql<number>`coalesce(sum(${orders.total}), 0)` })
      .from(orders)
      .where(
        and(
          eq(orders.merchantId, merchantId),
          inArray(orders.status, revenueStatuses),
          gte(orders.createdAt, today)
        )
      )

    const [ordersTodayRow] = await db
      .select({ count: count() })
      .from(orders)
      .where(
        and(eq(orders.merchantId, merchantId), gte(orders.createdAt, today))
      )

    const [pendingRow] = await db
      .select({ count: count() })
      .from(orders)
      .where(and(eq(orders.merchantId, merchantId), eq(orders.status, 'pending')))

    const [rangeRow] = await db
      .select({
        revenue: sql<number>`coalesce(sum(${orders.total}), 0)`,
        ordersCount: sql<number>`count(*)`
      })
      .from(orders)
      .where(
        and(
          eq(orders.merchantId, merchantId),
          inArray(orders.status, revenueStatuses),
          gte(orders.createdAt, start30)
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

    const chartRows = await db
      .select({
        day: sql<string>`to_char(${orders.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        revenue: sql<number>`coalesce(sum(${orders.total}), 0)`,
        ordersCount: sql<number>`count(*)`
      })
      .from(orders)
      .where(
        and(
          eq(orders.merchantId, merchantId),
          inArray(orders.status, revenueStatuses),
          gte(orders.createdAt, start30)
        )
      )
      .groupBy(sql`to_char(${orders.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`)

    const chartMap = new Map(chartRows.map((r) => [r.day, r]))
    const salesChart = Array.from({ length: 30 }, (_, i) => {
      const date = new Date(Date.now() - (29 - i) * 86400000)
      const key = dayKey(date)
      const row = chartMap.get(key)
      return {
        date: key,
        revenue: Number(row?.revenue ?? 0),
        orders: Number(row?.ordersCount ?? 0)
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
      .where(eq(orders.merchantId, merchantId))
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
          inArray(orders.status, revenueStatuses)
        )
      )
      .groupBy(products.id)
      .orderBy(sql`coalesce(sum(${orderItems.total}), 0) desc`)
      .limit(5)

    const avgOrderValue =
      Number(rangeRow?.ordersCount ?? 0) > 0
        ? Number(rangeRow?.revenue ?? 0) / Number(rangeRow?.ordersCount ?? 0)
        : 0

    return ok({
      todaySales: Number(todaySalesRow?.revenue ?? 0),
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
