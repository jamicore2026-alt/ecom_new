import { and, asc, count, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { db } from '../../database/client'
import { customers, orders, refunds, publicCustomerColumns } from '../../database/schema'
import { parseCsv, toCsv } from '../../shared/csv'
import { emit } from '../../shared/event-dispatch'
import { badRequest, notFound } from '../../shared/errors'
import { makeMeta, parsePagination } from '../../shared/pagination'
import { ok } from '../../shared/response'

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
      .select(publicCustomerColumns)
      .from(customers)
      .where(where)
      .orderBy(dir(sortCol))
      .limit(limit)
      .offset(offset)

    return ok({ items: rows, meta: makeMeta(page, limit, Number(total)) })
  }

  static async get(merchantId: string, id: string) {
    const [customer] = await db
      .select(publicCustomerColumns)
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
      .select(publicCustomerColumns)
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

  /* ------------------------------ csv export ------------------------------ */

  static async exportCsv(merchantId: string): Promise<string> {
    const rows = await db
      .select(publicCustomerColumns)
      .from(customers)
      .where(eq(customers.merchantId, merchantId))
      .orderBy(asc(customers.createdAt))

    const headers = [
      'email',
      'first_name',
      'last_name',
      'phone',
      'orders_count',
      'total_spent',
      'registered_at',
      'last_order_at'
    ]

    const csvRows: unknown[][] = rows.map((c) => [
      c.email,
      c.firstName ?? '',
      c.lastName ?? '',
      c.phone ?? '',
      c.ordersCount,
      c.totalSpent,
      c.createdAt.toISOString(),
      c.lastOrderAt ? c.lastOrderAt.toISOString() : ''
    ])

    return toCsv(headers, csvRows)
  }

  /* ------------------------------ csv import ------------------------------ */

  static async importCsv(merchantId: string, text: string) {
    const parsed = parseCsv(text)
    if (parsed.length < 2) {
      throw badRequest('BAD_REQUEST', 'CSV needs a header row and at least one data row')
    }
    const header = parsed[0].map((h) => h.trim().toLowerCase())
    const col = (name: string) => header.indexOf(name)
    if (col('email') === -1) throw badRequest('BAD_REQUEST', 'CSV must include an "email" column')

    const errors: Array<{ line: number; message: string }> = []
    let created = 0
    let updated = 0

    class RowError extends Error {}

    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

    for (let i = 1; i < parsed.length; i++) {
      try {
        const cells = parsed[i]
        const email = (cells[col('email')] ?? '').trim().toLowerCase()
        if (!email) throw new RowError('Missing required "email"')
        if (!EMAIL_RE.test(email)) throw new RowError(`Invalid email: ${email}`)

        const str = (name: string): string | null =>
          header.includes(name) ? (cells[col(name)] ?? '').trim() || null : null
        const firstName = str('first_name')
        const lastName = str('last_name')
        const phone = str('phone')

        const [existing] = await db
          .select(publicCustomerColumns)
          .from(customers)
          .where(and(eq(customers.merchantId, merchantId), eq(customers.email, email)))

        if (existing) {
          const patch: Partial<typeof customers.$inferInsert> = {}
          if (firstName !== null) patch.firstName = firstName
          if (lastName !== null) patch.lastName = lastName
          if (phone !== null) patch.phone = phone
          if (Object.keys(patch).length > 0) {
            await db.update(customers).set(patch).where(eq(customers.id, existing.id))
          }
          updated++
        } else {
          const [row] = await db
            .insert(customers)
            .values({ merchantId, email, firstName, lastName, phone })
            .returning()
          created++
          emit(merchantId, 'customer.created', { customerId: row.id, email: row.email })
        }
      } catch (e) {
        errors.push({ line: i + 1, message: e instanceof Error ? e.message : 'Import failed' })
      }
    }

    return ok({ created, updated, failed: errors.length, errors })
  }
}
