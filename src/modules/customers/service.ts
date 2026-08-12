import { and, asc, count, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { db } from '../../database/client'
import { customers, orders, refunds } from '../../database/schema'
import { makeMeta, parsePagination } from '../../shared/pagination'
import { ok } from '../../shared/response'
import { notFound } from '../../shared/errors'

const SORTABLE: Record<string, typeof customers.totalSpent | typeof customers.ordersCount | typeof customers.createdAt> = {
  total_spent: customers.totalSpent,
  orders_count: customers.ordersCount,
  created_at: customers.createdAt
}

export class CustomersService {
  static async list(
    merchantId: string,
    q: { page?: string; limit?: string; search?: string; tag?: string; sortBy?: string; sortOrder?: string }
  ) {
    const { page, limit, offset } = parsePagination(q)
    const conditions = [eq(customers.merchantId, merchantId)]

    if (q.search) {
      const s = `%${q.search.trim()}%`
      const cond = or(
        ilike(customers.email, s),
        ilike(customers.firstName, s),
        ilike(customers.lastName, s),
        ilike(customers.phone, s)
      )
      if (cond) conditions.push(cond)
    }
    if (q.tag) {
      conditions.push(sql`${customers.tags} @> ${JSON.stringify([q.tag])}::jsonb`)
    }

    const where = and(...conditions)
    const [{ total }] = await db.select({ total: count() }).from(customers).where(where)

    const sortCol = SORTABLE[q.sortBy ?? 'created_at']
    const dir = q.sortOrder === 'asc' ? asc : desc

    const rows = await db
      .select()
      .from(customers)
      .where(where)
      .orderBy(dir(sortCol))
      .limit(limit)
      .offset(offset)

    return ok({ items: rows, meta: makeMeta(page, limit, Number(total)) })
  }

  static async get(merchantId: string, id: string) {
    const [customer] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.merchantId, merchantId)))
    if (!customer) throw notFound('NOT_FOUND', 'Customer not found')

    const [refundRow] = await db
      .select({ total: sql<number>`coalesce(sum(${refunds.amount}), 0)` })
      .from(refunds)
      .innerJoin(orders, eq(refunds.orderId, orders.id))
      .where(and(eq(orders.customerId, customer.id), eq(orders.merchantId, merchantId)))

    const refundTotal = Number(refundRow?.total ?? 0)
    const avgOrderValue =
      customer.ordersCount > 0 ? Number((customer.totalSpent / customer.ordersCount).toFixed(2)) : 0

    return ok({
      ...customer,
      netSpent: Number((customer.totalSpent - refundTotal).toFixed(2)),
      refundTotal,
      avgOrderValue
    })
  }

  static async orders(merchantId: string, customerId: string, q: { page?: string; limit?: string }) {
    const { page, limit, offset } = parsePagination(q)

    const [customer] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.merchantId, merchantId)))
    if (!customer) throw notFound('NOT_FOUND', 'Customer not found')

    const where = and(eq(orders.merchantId, merchantId), eq(orders.customerId, customerId))
    const [{ total }] = await db.select({ total: count() }).from(orders).where(where)
    const items = await db
      .select()
      .from(orders)
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset)

    return ok({ items, meta: makeMeta(page, limit, Number(total)) })
  }
}
