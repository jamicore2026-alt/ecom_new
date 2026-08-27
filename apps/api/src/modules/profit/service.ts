import { and, eq, gte, inArray, lte } from 'drizzle-orm'
import { db } from '../../database/client'
import { merchants, orderItems, orders, products } from '../../database/schema'
import { ok } from '../../shared/response'
import { roundForCurrency } from '../../shared/currency'

export class ProfitService {
  /** Gross profit = revenue - COGS, computed across paid orders in a range. */
  static async report(merchantId: string, range: { from?: Date; to?: Date }) {
    const [merchant] = await db
      .select({ currency: merchants.currency })
      .from(merchants)
      .where(eq(merchants.id, merchantId))
    const currency = merchant?.currency ?? 'USD'

    const conditions: any[] = [eq(orders.merchantId, merchantId), eq(orders.paymentStatus, 'paid')]
    if (range.from) conditions.push(gte(orders.createdAt, range.from))
    if (range.to) conditions.push(lte(orders.createdAt, range.to))

    const ords = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(...conditions))

    const orderIds = ords.map((o) => o.id)
    let revenue = 0
    let totalCost = 0

    if (orderIds.length > 0) {
      // Revenue per order is stored; sum the paid totals.
      const revRows = await db
        .select({ id: orders.id, total: orders.total })
        .from(orders)
        .where(inArray(orders.id, orderIds))
      for (const r of revRows) revenue += Number(r.total)

      // COGS = sum(qty * product.cost) across all items in these orders.
      const items = await db
        .select({
          productId: orderItems.productId,
          quantity: orderItems.quantity
        })
        .from(orderItems)
        .where(inArray(orderItems.orderId, orderIds))

      const productIds = [...new Set(items.map((i) => i.productId).filter((id): id is string => Boolean(id)))]
      let costs = new Map<string, number>()
      if (productIds.length > 0) {
        const prodRows = await db
          .select({ id: products.id, cost: products.cost })
          .from(products)
          .where(inArray(products.id, productIds))
        costs = new Map(prodRows.map((p) => [p.id, Number(p.cost)]))
      }

      for (const it of items) {
        totalCost += (costs.get(it.productId ?? '') ?? 0) * it.quantity
      }
    }

    const grossProfit = revenue - totalCost

    return ok({
      range: {
        from: range.from ?? null,
        to: range.to ?? null
      },
      metrics: {
        revenue: roundForCurrency(revenue, currency),
        cogs: roundForCurrency(totalCost, currency),
        grossProfit: roundForCurrency(grossProfit, currency),
        margin: revenue > 0 ? roundForCurrency((grossProfit / revenue) * 100, currency) : 0,
        orderCount: ords.length
      }
    })
  }
}
