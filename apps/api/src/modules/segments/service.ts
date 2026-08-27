import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../database/client'
import { customers, customerSegments, orders } from '../../database/schema'
import { ok } from '../../shared/response'
import { notFound } from '../../shared/errors'

export type SegmentDefinition = {
  minSpent?: number
  minOrders?: number
}

export class SegmentsService {
  static async list(merchantId: string) {
    const rows = await db
      .select()
      .from(customerSegments)
      .where(eq(customerSegments.merchantId, merchantId))
      .orderBy(desc(customerSegments.createdAt))
    return ok({ items: rows })
  }

  static async get(merchantId: string, id: string) {
    const [row] = await db
      .select()
      .from(customerSegments)
      .where(and(eq(customerSegments.id, id), eq(customerSegments.merchantId, merchantId)))
    if (!row) throw notFound('SEGMENT_NOT_FOUND', 'Segment not found')
    return ok(row)
  }

  static async create(merchantId: string, input: { name: string; definition: SegmentDefinition }) {
    const members = await this.listMembers(merchantId, input.definition)
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

  static async update(merchantId: string, id: string, input: { name?: string; definition?: SegmentDefinition }) {
    await this.get(merchantId, id)
    const members = input.definition ? await this.listMembers(merchantId, input.definition) : undefined
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

  static async delete(merchantId: string, id: string) {
    await this.get(merchantId, id)
    await db
      .delete(customerSegments)
      .where(and(eq(customerSegments.id, id), eq(customerSegments.merchantId, merchantId)))
    return ok({ deleted: true })
  }

  static async preview(merchantId: string, definition: SegmentDefinition) {
    const members = await this.listMembers(merchantId, definition)
    return ok({ count: members.length })
  }

  /**
   * Find customers matching a segment definition via live SQL aggregation.
   * minSpent: customer lifetime paid revenue >= value.
   * minOrders: customer paid order count >= value.
   */
  static async listMembers(
    merchantId: string,
    def: SegmentDefinition
  ): Promise<{ id: string; email: string }[]> {
    const paid = await db
      .select({
        customerId: orders.customerId,
        total: orders.total
      })
      .from(orders)
      .where(and(eq(orders.merchantId, merchantId), eq(orders.paymentStatus, 'paid')))

    const perCustomer = new Map<string, { spent: number; orders: number }>()
    for (const row of paid) {
      if (!row.customerId) continue
      const cur = perCustomer.get(row.customerId) ?? { spent: 0, orders: 0 }
      cur.spent += Number(row.total)
      cur.orders += 1
      perCustomer.set(row.customerId, cur)
    }

    const allCustomers = await db
      .select({ id: customers.id, email: customers.email })
      .from(customers)
      .where(eq(customers.merchantId, merchantId))

    const members: { id: string; email: string }[] = []
    for (const c of allCustomers) {
      const stats = perCustomer.get(c.id) ?? { spent: 0, orders: 0 }
      if (def.minSpent !== undefined && stats.spent < def.minSpent) continue
      if (def.minOrders !== undefined && stats.orders < def.minOrders) continue
      members.push(c)
    }

    return members
  }
}
