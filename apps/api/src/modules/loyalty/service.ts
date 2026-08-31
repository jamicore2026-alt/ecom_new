import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { db } from '../../database/client'
import { customers, loyaltyAccounts, loyaltyLedger } from '../../database/schema'
import { ok } from '../../shared/response'
import { notFound } from '../../shared/errors'

export class LoyaltyService {
  /** Verify the customer belongs to the current merchant before touching loyalty data. */
  private static async assertCustomer(merchantId: string, customerId: string) {
    const [customer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.merchantId, merchantId)))
      .limit(1)
    if (!customer) throw notFound('CUSTOMER_NOT_FOUND', 'Customer not found')
  }

  /** Ensure a loyalty account exists for a customer and return it. */
  static async ensureAccount(merchantId: string, customerId: string) {
    await this.assertCustomer(merchantId, customerId)
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
   * Adjust points atomically and write a ledger entry in the same transaction.
   * The conditional UPDATE prevents concurrent debits from overspending a balance
   * and SQL expressions prevent lost updates under concurrent credits/debits.
   */
  static async adjust(
    merchantId: string,
    customerId: string,
    input: { points: number; type: string; reference?: string; meta?: Record<string, unknown> }
  ) {
    const account = await this.ensureAccount(merchantId, customerId)
    if (!account) throw notFound('LOYALTY_ACCOUNT_NOT_FOUND', 'Loyalty account not found')

    return await db.transaction(async (tx) => {
      const conditions = [
        eq(loyaltyAccounts.id, account.id),
        eq(loyaltyAccounts.merchantId, merchantId),
        eq(loyaltyAccounts.customerId, customerId)
      ]
      if (input.points < 0) conditions.push(gte(loyaltyAccounts.points, -input.points))

      const [updated] = await tx
        .update(loyaltyAccounts)
        .set({
          points: sql`${loyaltyAccounts.points} + ${input.points}`,
          ...(input.points > 0 && {
            lifetimePoints: sql`${loyaltyAccounts.lifetimePoints} + ${input.points}`
          })
        })
        .where(and(...conditions))
        .returning()

      if (!updated) {
        throw notFound('INSUFFICIENT_POINTS', 'Customer does not have enough loyalty points')
      }

      const [entry] = await tx
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
    })
  }

  static async getByCustomer(merchantId: string, customerId: string) {
    const account = await this.ensureAccount(merchantId, customerId)
    return ok(account)
  }

  static async ledger(merchantId: string, customerId: string) {
    await this.assertCustomer(merchantId, customerId)
    const rows = await db
      .select()
      .from(loyaltyLedger)
      .where(and(eq(loyaltyLedger.merchantId, merchantId), eq(loyaltyLedger.customerId, customerId)))
      .orderBy(loyaltyLedger.createdAt)
      .limit(100)
    return ok({ items: rows })
  }

  /**
   * Merchant-wide loyalty program overview aggregated from the loyalty tables.
   * Returns member counts, outstanding/redeemable balance, lifetime points issued,
   * total redeemed, and a tier distribution.
   */
  static async overview(merchantId: string) {
    const [counts] = await db
      .select({
        members: sql<number>`count(*)::int`,
        totalPoints: sql<number>`coalesce(sum(${loyaltyAccounts.points}), 0)::int`,
        lifetimePoints: sql<number>`coalesce(sum(${loyaltyAccounts.lifetimePoints}), 0)::int`
      })
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.merchantId, merchantId))

    const [redeemed] = await db
      .select({ total: sql<number>`coalesce(sum(-${loyaltyLedger.points}), 0)::int` })
      .from(loyaltyLedger)
      .where(and(eq(loyaltyLedger.merchantId, merchantId), lt(loyaltyLedger.points, 0)))

    const tierRows = await db
      .select({ tier: loyaltyAccounts.tier, count: sql<number>`count(*)::int` })
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.merchantId, merchantId))
      .groupBy(loyaltyAccounts.tier)

    const tiers = tierRows.map((r) => ({ tier: r.tier, count: r.count }))

    return ok({
      memberCount: counts?.members ?? 0,
      totalPoints: counts?.totalPoints ?? 0,
      lifetimePoints: counts?.lifetimePoints ?? 0,
      totalRedeemed: redeemed?.total ?? 0,
      tiers
    })
  }
}
