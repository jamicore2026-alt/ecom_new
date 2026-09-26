import { and, asc, count, desc, eq, ilike, or, sql } from 'drizzle-orm'
import type { DB } from '../../database/client'
import { customers, orders, refunds, publicCustomerColumns } from '../../database/schema'
import { parseCsv, toCsv } from '../../shared/csv'
import { emit } from '../../shared/event-dispatch'
import { badRequest, conflict, notFound } from '../../shared/errors'
import { makeMeta, parsePagination } from '../../shared/pagination'
import { ok } from '../../shared/response'

export interface CustomerUpsert {
  email: string
  firstName?: string | null
  lastName?: string | null
  phone?: string | null
  tags?: string[]
  marketingOptOut?: boolean
}

const SORTABLE: Record<string, typeof customers.totalSpent | typeof customers.ordersCount | typeof customers.createdAt> = {
  total_spent: customers.totalSpent,
  orders_count: customers.ordersCount,
  created_at: customers.createdAt
}

export class CustomersService {
  static async list(
    db: DB,
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

  static async get(db: DB, merchantId: string, id: string) {
    const [customer] = await db
      .select(publicCustomerColumns)
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.merchantId, merchantId)))
    if (!customer) throw notFound('NOT_FOUND', 'Customer not found')

    const [flags] = await db
      .select({ marketingOptOut: customers.marketingOptOut, tags: customers.tags })
      .from(customers)
      .where(eq(customers.id, id))

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
      marketingOptOut: flags?.marketingOptOut ?? false,
      netSpent: Number((customer.totalSpent - refundTotal).toFixed(2)),
      refundTotal,
      avgOrderValue
    })
  }

  /* ------------------------------ manual CRUD ----------------------------- */

  static async create(db: DB, merchantId: string, input: CustomerUpsert) {
    const email = input.email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      throw badRequest('BAD_REQUEST', 'A valid email is required')
    }
    const [existing] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.merchantId, merchantId), eq(customers.email, email)))
    if (existing) throw conflict('DUPLICATE', 'A customer with this email already exists')

    const [row] = await db
      .insert(customers)
      .values({
        merchantId,
        email,
        firstName: input.firstName?.trim() || null,
        lastName: input.lastName?.trim() || null,
        phone: input.phone?.trim() || null,
        tags: input.tags ?? [],
        marketingOptOut: input.marketingOptOut ?? false
      })
      .returning()
    emit(merchantId, 'customer.created', { customerId: row.id, email: row.email })
    const [created] = await db
      .select(publicCustomerColumns)
      .from(customers)
      .where(eq(customers.id, row.id))
    return ok({ ...created, marketingOptOut: row.marketingOptOut })
  }

  static async update(
    db: DB,
    merchantId: string,
    id: string,
    input: Partial<CustomerUpsert> & { email?: string }
  ) {
    const [existing] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.merchantId, merchantId)))
    if (!existing) throw notFound('NOT_FOUND', 'Customer not found')

    const patch: Partial<typeof customers.$inferInsert> = {}
    if (input.email !== undefined) {
      const email = input.email.trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        throw badRequest('BAD_REQUEST', 'A valid email is required')
      }
      const [dup] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.merchantId, merchantId), eq(customers.email, email)))
      if (dup && dup.id !== id) throw conflict('DUPLICATE', 'A customer with this email already exists')
      patch.email = email
    }
    if (input.firstName !== undefined) patch.firstName = input.firstName?.trim() || null
    if (input.lastName !== undefined) patch.lastName = input.lastName?.trim() || null
    if (input.phone !== undefined) patch.phone = input.phone?.trim() || null
    if (input.tags !== undefined) patch.tags = input.tags
    if (input.marketingOptOut !== undefined) patch.marketingOptOut = input.marketingOptOut

    if (Object.keys(patch).length === 0) return this.get(db, merchantId, id)
    await db.update(customers).set(patch).where(eq(customers.id, id))
    return this.get(db, merchantId, id)
  }

  /**
   * Delete a customer. There is no `status`/`archived` column on customers, so
   * deletion is a hard delete — blocked when orders reference the customer to
   * preserve order history (anonymize via update instead: blank name/phone).
   */
  static async remove(db: DB, merchantId: string, id: string) {
    const [existing] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.merchantId, merchantId)))
    if (!existing) throw notFound('NOT_FOUND', 'Customer not found')

    const [{ total }] = await db
      .select({ total: count() })
      .from(orders)
      .where(and(eq(orders.merchantId, merchantId), eq(orders.customerId, id)))
    if (Number(total) > 0) {
      throw badRequest(
        'HAS_ORDERS',
        'Customer has orders and cannot be deleted. Anonymize personal fields instead.'
      )
    }
    await db.delete(customers).where(eq(customers.id, id))
    return ok({ id, deleted: true })
  }

  /** Marketing opt-out toggle (campaigns + cart-recovery respect the flag). */
  static async setOptOut(db: DB, merchantId: string, id: string, optOut: boolean) {
    const [existing] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.merchantId, merchantId)))
    if (!existing) throw notFound('NOT_FOUND', 'Customer not found')
    await db.update(customers).set({ marketingOptOut: optOut }).where(eq(customers.id, id))
    return this.get(db, merchantId, id)
  }

  /** Public unsubscribe by email (no auth — linked from campaign footers). */
  static async unsubscribeByEmail(db: DB, merchantId: string, email: string) {
    const normalized = email.trim().toLowerCase()
    const [existing] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.merchantId, merchantId), eq(customers.email, normalized)))
    if (!existing) return ok({ email: normalized, optedOut: false, known: false })
    await db
      .update(customers)
      .set({ marketingOptOut: true })
      .where(eq(customers.id, existing.id))
    return ok({ email: normalized, optedOut: true, known: true })
  }

  static async orders(db: DB, merchantId: string, customerId: string, q: { page?: string; limit?: string }) {    const { page, limit, offset } = parsePagination(q)

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

  static async exportCsv(db: DB, merchantId: string): Promise<string> {
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

  static async importCsv(db: DB, merchantId: string, text: string) {
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
