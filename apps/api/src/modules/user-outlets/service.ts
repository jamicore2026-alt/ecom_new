import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../database/client'
import { userOutlets, outlets, users } from '../../database/schema'
import { ok } from '../../shared/response'
import { notFound } from '../../shared/errors'

export class UserOutletsService {
  /** List outlets a given user is explicitly assigned to. */
  static async listForUser(merchantId: string, userId: string) {
    // ensure the user belongs to this merchant
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.merchantId, merchantId)))
    if (!user) throw notFound('NOT_FOUND', 'User not found')

    const rows = await db
      .select({ outlet: outlets })
      .from(userOutlets)
      .innerJoin(outlets, eq(userOutlets.outletId, outlets.id))
      .where(eq(userOutlets.userId, userId))
    return ok(rows.map((r) => r.outlet))
  }

  /** Replace the outlet assignments for a user (must all belong to merchant). */
  static async assign(merchantId: string, userId: string, outletIds: string[]) {
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.merchantId, merchantId)))
    if (!user) throw notFound('NOT_FOUND', 'User not found')

    const ids = [...new Set(outletIds)]
    if (ids.length > 0) {
      const outRows = await db
        .select()
        .from(outlets)
        .where(and(inArray(outlets.id, ids), eq(outlets.merchantId, merchantId)))
      if (outRows.length !== ids.length) {
        throw notFound('OUTLET_NOT_FOUND', 'One or more outlets not found')
      }
    }

    await db.delete(userOutlets).where(eq(userOutlets.userId, userId))
    if (ids.length > 0) {
      await db.insert(userOutlets).values(ids.map((outletId) => ({ userId, outletId })))
    }
    return { success: true, data: { userId, outlets: ids } }
  }
}
