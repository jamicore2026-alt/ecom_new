import { and, eq } from 'drizzle-orm'
import type { DB } from '../../database/client'
import { customerTags } from '../../database/schema'
import { ok } from '../../shared/response'

export class CustomerTagsService {
  static async listByCustomer(db: DB, merchantId: string, customerId: string) {
    const rows = await db
      .select()
      .from(customerTags)
      .where(and(eq(customerTags.merchantId, merchantId), eq(customerTags.customerId, customerId)))
    return ok({ items: rows.map((r) => r.tag) })
  }

  static async add(db: DB, merchantId: string, customerId: string, tag: string) {
    const clean = tag.trim().slice(0, 100)
    if (!clean) return this.listByCustomer(db, merchantId, customerId)
    await db
      .insert(customerTags)
      .values({ merchantId, customerId, tag: clean })
      .onConflictDoNothing({ target: [customerTags.merchantId, customerTags.customerId, customerTags.tag] })
    return this.listByCustomer(db, merchantId, customerId)
  }

  static async remove(db: DB, merchantId: string, customerId: string, tag: string) {
    await db
      .delete(customerTags)
      .where(and(eq(customerTags.merchantId, merchantId), eq(customerTags.customerId, customerId), eq(customerTags.tag, tag)))
    return this.listByCustomer(db, merchantId, customerId)
  }
}
