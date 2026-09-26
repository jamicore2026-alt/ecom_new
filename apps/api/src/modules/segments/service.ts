import { and, desc, eq, sql } from 'drizzle-orm'
import type { DB } from '../../database/client'
import { customers, customerSegments, customerTags, orders } from '../../database/schema'
import { ok } from '../../shared/response'
import { notFound } from '../../shared/errors'

/**
 * Segment definition (RFM + recency + tags):
 * - minSpent: lifetime paid revenue >= value
 * - minOrders: paid order count >= value
 * - recencyDays: last paid order (or customer.lastOrderAt fallback) within N days
 * - tags: customer carries at least one of these tags (customers.tags or customer_tags)
 */
export type SegmentDefinition = {
  minSpent?: number
  minOrders?: number
  recencyDays?: number
  tags?: string[]
}

export class SegmentsService {
  static async list(db: DB, merchantId: string) {
    const rows = await db
      .select()
      .from(customerSegments)
      .where(eq(customerSegments.merchantId, merchantId))
      .orderBy(desc(customerSegments.createdAt))
    return ok({ items: rows })
  }

  static async get(db: DB, merchantId: string, id: string) {
    const [row] = await db
      .select()
      .from(customerSegments)
      .where(and(eq(customerSegments.id, id), eq(customerSegments.merchantId, merchantId)))
    if (!row) throw notFound('SEGMENT_NOT_FOUND', 'Segment not found')
    return ok(row)
  }

  static async create(db: DB, merchantId: string, input: { name: string; definition: SegmentDefinition }) {
    const members = await this.listMembers(db, merchantId, input.definition)
    const [row] = await db
      .insert(customerSegments)
      .values({
        merchantId,
        name: input.name,
        definition: input.definition as unknown as object,
        customerCount: members.length
      })
      .returning()
    return ok(row)
  }

  static async update(db: DB, merchantId: string, id: string, input: { name?: string; definition?: SegmentDefinition }) {
    await this.get(db, merchantId, id)
    const members = input.definition ? await this.listMembers(db, merchantId, input.definition) : undefined
    const [row] = await db
      .update(customerSegments)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.definition !== undefined && { definition: input.definition as unknown as object }),
        ...(members !== undefined && { customerCount: members.length })
      })
      .where(and(eq(customerSegments.id, id), eq(customerSegments.merchantId, merchantId)))
      .returning()
    return ok(row)
  }

  /** Recompute and persist customerCount for one segment (or all when id omitted). */
  static async refresh(db: DB, merchantId: string, id?: string) {
    const conditions = [eq(customerSegments.merchantId, merchantId)]
    if (id) {
      const [row] = await db
        .select()
        .from(customerSegments)
        .where(and(eq(customerSegments.id, id), eq(customerSegments.merchantId, merchantId)))
      if (!row) throw notFound('SEGMENT_NOT_FOUND', 'Segment not found')
      const members = await this.listMembers(db, merchantId, (row.definition ?? {}) as SegmentDefinition)
      const [updated] = await db
        .update(customerSegments)
        .set({ customerCount: members.length })
        .where(eq(customerSegments.id, id))
        .returning()
      return ok({ refreshed: 1, segments: [{ id, customerCount: members.length, updated }] })
    }
    const rows = await db
      .select()
      .from(customerSegments)
      .where(and(...conditions))
    const out: Array<{ id: string; customerCount: number }> = []
    for (const row of rows) {
      const members = await this.listMembers(db, merchantId, (row.definition ?? {}) as SegmentDefinition)
      await db
        .update(customerSegments)
        .set({ customerCount: members.length })
        .where(eq(customerSegments.id, row.id))
      out.push({ id: row.id, customerCount: members.length })
    }
    return ok({ refreshed: out.length, segments: out })
  }

  static async delete(db: DB, merchantId: string, id: string) {
    await this.get(db, merchantId, id)
    await db
      .delete(customerSegments)
      .where(and(eq(customerSegments.id, id), eq(customerSegments.merchantId, merchantId)))
    return ok({ deleted: true })
  }

  static async preview(db: DB, merchantId: string, definition: SegmentDefinition) {
    const members = await this.listMembers(db, merchantId, definition)
    return ok({ count: members.length })
  }

  static async members(db: DB, merchantId: string, id: string) {
    const segment = (await this.get(db, merchantId, id)).data
    const members = await this.listMembers(db, merchantId, (segment.definition ?? {}) as SegmentDefinition)
    return ok({ items: members, count: members.length })
  }

  /**
   * Find customers matching a segment definition via live SQL aggregation.
   * minSpent: customer lifetime paid revenue >= value.
   * minOrders: customer paid order count >= value.
   * recencyDays: most recent paid order within the last N days (falls back to
   *   customers.lastOrderAt when the customer has no paid order rows).
   * tags: customer.tags array or customer_tags row contains at least one entry.
   */
  static async listMembers(
    db: DB,
    merchantId: string,
    def: SegmentDefinition
  ): Promise<{ id: string; email: string }[]> {
    const paid = await db
      .select({
        customerId: orders.customerId,
        total: orders.total,
        createdAt: orders.createdAt
      })
      .from(orders)
      .where(and(eq(orders.merchantId, merchantId), eq(orders.paymentStatus, 'paid')))

    const perCustomer = new Map<string, { spent: number; orders: number; lastPaidAt: Date | null }>()
    for (const row of paid) {
      if (!row.customerId) continue
      const cur = perCustomer.get(row.customerId) ?? { spent: 0, orders: 0, lastPaidAt: null }
      cur.spent += Number(row.total)
      cur.orders += 1
      if (row.createdAt && (!cur.lastPaidAt || row.createdAt > cur.lastPaidAt)) {
        cur.lastPaidAt = row.createdAt
      }
      perCustomer.set(row.customerId, cur)
    }

    const tagged = new Map<string, Set<string>>()
    if (def.tags && def.tags.length > 0) {
      const rows = await db
        .select({ customerId: customerTags.customerId, tag: customerTags.tag })
        .from(customerTags)
        .where(eq(customerTags.merchantId, merchantId))
      for (const r of rows) {
        const set = tagged.get(r.customerId) ?? new Set<string>()
        set.add(r.tag)
        tagged.set(r.customerId, set)
      }
    }

    const allCustomers = await db
      .select({
        id: customers.id,
        email: customers.email,
        tags: customers.tags,
        lastOrderAt: customers.lastOrderAt
      })
      .from(customers)
      .where(eq(customers.merchantId, merchantId))

    const now = Date.now()
    const members: { id: string; email: string }[] = []
    for (const c of allCustomers) {
      const stats = perCustomer.get(c.id) ?? { spent: 0, orders: 0, lastPaidAt: null }
      if (def.minSpent !== undefined && stats.spent < def.minSpent) continue
      if (def.minOrders !== undefined && stats.orders < def.minOrders) continue
      if (def.recencyDays !== undefined) {
        const last = stats.lastPaidAt ?? c.lastOrderAt
        if (!last) continue
        const ageDays = (now - new Date(last).getTime()) / (24 * 60 * 60 * 1000)
        if (ageDays > def.recencyDays) continue
      }
      if (def.tags && def.tags.length > 0) {
        const inline = Array.isArray(c.tags) ? c.tags : []
        const extra = tagged.get(c.id)
        const hit = def.tags.some((t) => inline.includes(t) || extra?.has(t))
        if (!hit) continue
      }
      members.push({ id: c.id, email: c.email })
    }

    return members
  }

  /** Backfill helper for the worker: refresh counts for stale segments. */
  static async refreshStale(db: DB, olderThanMinutes = 60 * 24): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000)
    const rows = await db
      .select()
      .from(customerSegments)
      .where(sql`${customerSegments.updatedAt} < ${cutoff}`)
      .limit(50)
    for (const row of rows) {
      const members = await this.listMembers(
        db,
        row.merchantId,
        (row.definition ?? {}) as SegmentDefinition
      )
      await db
        .update(customerSegments)
        .set({ customerCount: members.length })
        .where(eq(customerSegments.id, row.id))
    }
    return rows.length
  }
}
