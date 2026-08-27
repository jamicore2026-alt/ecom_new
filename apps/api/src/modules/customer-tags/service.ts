import { and, eq } from 'drizzle-orm'
import { db } from '../../database/client'
import { customerTags } from '../../database/schema'
import { ok } from '../../shared/response'

export class CustomerTagsService {
  static async listByCustomer(merchantId: string, customerId: string) {
    const rows = await db
      .select()
      .from(customerTags)
      .where(and(eq(customerTags.merchantId, merchantId), eq(customerTags.customerId, customerId)))
    return ok({ items: rows.map((r) => r.tag) })
  }

  static async add(merchantId: string, customerId: string, tag: string) {
    const clean = tag.trim().slice(0, 100)
    if (!clean) return this.listByCustomer(merchantId, customerId)
    await db
      .insert(customerTags)
      .values({ merchantId, customerId, tag: clean })
      .onConflictDoNothing({ target: [customerTags.merchantId, customerTags.customerId, customerTags.tag] })
    return this.listByCustomer(merchantId, customerId)
  }

  static async remove(merchantId: string, customerId: string, tag: string) {
    await db
      .delete(customerTags)
      .where(and(eq(customerTags.merchantId, merchantId), eq(customerTags.customerId, customerId), eq(customerTags.tag, tag)))
    return this.listByCustomer(merchantId, customerId)
  }
}
