import { and, eq } from 'drizzle-orm'
import { db } from '../../database/client'
import { loyaltyAccounts, loyaltyLedger } from '../../database/schema'
import { ok } from '../../shared/response'
import { notFound } from '../../shared/errors'

export class LoyaltyService {
  /** Ensure a loyalty account exists for a customer and return it. */
  static async ensureAccount(merchantId: string, customerId: string) {
    const [existing] = await db
      .select()
      .from(loyaltyAccounts)
      .where(and(eq(loyaltyAccounts.merchantId, merchantId), eq(loyaltyAccounts.customerId, customerId)))
    if (existing) return existing

    const [created] = await db
      .insert(loyaltyAccounts)
      .values({ merchantId, customerId, points: 0, lifetimePoints: 0, tier: 'standard' })
      .onConflictDoNothing({ target: [loyaltyAccounts.merchantId, loyaltyAccounts.customerId] })
      .returning()
    if (created) return created
    const [row] = await db
      .select()
      .from(loyaltyAccounts)
      .where(and(eq(loyaltyAccounts.merchantId, merchantId), eq(loyaltyAccounts.customerId, customerId)))
    return row
  }

  /**
   * Adjust points atomically and write a ledger entry.
   * Allowed only for administered adjustments (no auth on shopper flow here).
   */
  static async adjust(
    merchantId: string,
    customerId: string,
    input: { points: number; type: string; reference?: string; meta?: Record<string, unknown> }
  ) {
    const account = await this.ensureAccount(merchantId, customerId)
    if (!account) throw notFound('LOYALTY_ACCOUNT_NOT_FOUND', 'Loyalty account not found')

    let balanceAfter = account.points + input.points
    if (balanceAfter < 0) {
      throw notFound('INSUFFICIENT_POINTS', 'Customer does not have enough loyalty points')
    }

    const [updated] = await db
      .update(loyaltyAccounts)
      .set({
        points: Math.max(0, balanceAfter),
        lifetimePoints: input.points > 0 ? account.lifetimePoints + input.points : account.lifetimePoints
      })
      .where(eq(loyaltyAccounts.id, account.id))
      .returning()

    const [entry] = await db
      .insert(loyaltyLedger)
      .values({
        merchantId,
        customerId,
        type: input.type,
        points: input.points,
        balanceAfter: updated.points,
        reference: input.reference ?? null,
        meta: (input.meta as object) ?? {}
      })
      .returning()

    return ok({ account: updated, entry })
  }

  static async getByCustomer(merchantId: string, customerId: string) {
    const account = await this.ensureAccount(merchantId, customerId)
    return ok(account)
  }

  static async ledger(merchantId: string, customerId: string) {
    const rows = await db
      .select()
      .from(loyaltyLedger)
      .where(and(eq(loyaltyLedger.merchantId, merchantId), eq(loyaltyLedger.customerId, customerId)))
      .orderBy(loyaltyLedger.createdAt)
      .limit(100)
    return ok({ items: rows })
  }
}
