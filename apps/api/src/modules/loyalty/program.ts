import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { DB } from '../../database/client'
import { loyaltyEarningRules, loyaltyRewards, loyaltyTiers, loyaltyAccounts } from '../../database/schema'
import { ok } from '../../shared/response'
import { notFound } from '../../shared/errors'

export type TierInput = { name: string; minPoints: number; perks?: Record<string, unknown>; status?: string }
export type RuleInput = { name: string; trigger: string; awardType?: string; awardValue?: number; enabled?: boolean }
export type RewardInput = {
  name: string
  description?: string | null
  type?: string
  pointsCost?: number
  status?: string
  stock?: number | null
}

export class LoyaltyProgramService {
  // ---- tiers ----

  static async listTiers(db: DB, merchantId: string) {
    const rows = await db
      .select()
      .from(loyaltyTiers)
      .where(eq(loyaltyTiers.merchantId, merchantId))
      .orderBy(asc(loyaltyTiers.minPoints))

    const counts = await db
      .select({ tier: loyaltyAccounts.tier, count: sql<number>`count(*)::int` })
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.merchantId, merchantId))
      .groupBy(loyaltyAccounts.tier)

    const memberMap = new Map<string, number>(counts.map((c) => [c.tier, c.count]))
    return ok({
      items: rows.map((r) => ({ ...r, memberCount: memberMap.get(r.name) ?? 0 }))
    })
  }

  static async createTier(db: DB, merchantId: string, input: TierInput) {
    const [row] = await db
      .insert(loyaltyTiers)
      .values({
        merchantId,
        name: input.name,
        minPoints: input.minPoints,
        perks: (input.perks as object) ?? {},
        ...(input.status !== undefined && { status: input.status })
      })
      .returning()
    return ok(row)
  }

  static async updateTier(db: DB, merchantId: string, id: string, input: Partial<TierInput>) {
    await this.assertTier(db, merchantId, id)
    const [row] = await db
      .update(loyaltyTiers)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.minPoints !== undefined && { minPoints: input.minPoints }),
        ...(input.perks !== undefined && { perks: input.perks as object }),
        ...(input.status !== undefined && { status: input.status })
      })
      .where(and(eq(loyaltyTiers.id, id), eq(loyaltyTiers.merchantId, merchantId)))
      .returning()
    return ok(row)
  }

  static async deleteTier(db: DB, merchantId: string, id: string) {
    await this.assertTier(db, merchantId, id)
    await db
      .delete(loyaltyTiers)
      .where(and(eq(loyaltyTiers.id, id), eq(loyaltyTiers.merchantId, merchantId)))
    return ok({ deleted: true })
  }

  private static async assertTier(db: DB, merchantId: string, id: string) {
    const [row] = await db
      .select()
      .from(loyaltyTiers)
      .where(and(eq(loyaltyTiers.id, id), eq(loyaltyTiers.merchantId, merchantId)))
    if (!row) throw notFound('TIER_NOT_FOUND', 'Loyalty tier not found')
    return row
  }

  // ---- earning rules ----

  static async listRules(db: DB, merchantId: string) {
    const rows = await db
      .select()
      .from(loyaltyEarningRules)
      .where(eq(loyaltyEarningRules.merchantId, merchantId))
      .orderBy(desc(loyaltyEarningRules.createdAt))
    return ok({ items: rows })
  }

  static async createRule(db: DB, merchantId: string, input: RuleInput) {
    const [row] = await db
      .insert(loyaltyEarningRules)
      .values({
        merchantId,
        name: input.name,
        trigger: input.trigger,
        awardType: input.awardType ?? 'points',
        awardValue: input.awardValue ?? 0,
        enabled: input.enabled ?? true
      })
      .returning()
    return ok(row)
  }

  static async updateRule(db: DB, merchantId: string, id: string, input: Partial<RuleInput>) {
    await this.assertRule(db, merchantId, id)
    const [row] = await db
      .update(loyaltyEarningRules)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.trigger !== undefined && { trigger: input.trigger }),
        ...(input.awardType !== undefined && { awardType: input.awardType }),
        ...(input.awardValue !== undefined && { awardValue: input.awardValue }),
        ...(input.enabled !== undefined && { enabled: input.enabled })
      })
      .where(and(eq(loyaltyEarningRules.id, id), eq(loyaltyEarningRules.merchantId, merchantId)))
      .returning()
    return ok(row)
  }

  static async deleteRule(db: DB, merchantId: string, id: string) {
    await this.assertRule(db, merchantId, id)
    await db
      .delete(loyaltyEarningRules)
      .where(and(eq(loyaltyEarningRules.id, id), eq(loyaltyEarningRules.merchantId, merchantId)))
    return ok({ deleted: true })
  }

  private static async assertRule(db: DB, merchantId: string, id: string) {
    const [row] = await db
      .select()
      .from(loyaltyEarningRules)
      .where(and(eq(loyaltyEarningRules.id, id), eq(loyaltyEarningRules.merchantId, merchantId)))
    if (!row) throw notFound('RULE_NOT_FOUND', 'Earning rule not found')
    return row
  }

  // ---- rewards catalog ----

  static async listRewards(db: DB, merchantId: string) {
    const rows = await db
      .select()
      .from(loyaltyRewards)
      .where(eq(loyaltyRewards.merchantId, merchantId))
      .orderBy(desc(loyaltyRewards.createdAt))
    return ok({ items: rows })
  }

  static async createReward(db: DB, merchantId: string, input: RewardInput) {
    const [row] = await db
      .insert(loyaltyRewards)
      .values({
        merchantId,
        name: input.name,
        description: input.description ?? null,
        type: input.type ?? 'product',
        pointsCost: input.pointsCost ?? 0,
        status: input.status ?? 'active',
        stock: input.stock ?? null
      })
      .returning()
    return ok(row)
  }

  static async updateReward(db: DB, merchantId: string, id: string, input: Partial<RewardInput>) {
    await this.assertReward(db, merchantId, id)
    const [row] = await db
      .update(loyaltyRewards)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.type !== undefined && { type: input.type }),
        ...(input.pointsCost !== undefined && { pointsCost: input.pointsCost }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.stock !== undefined && { stock: input.stock })
      })
      .where(and(eq(loyaltyRewards.id, id), eq(loyaltyRewards.merchantId, merchantId)))
      .returning()
    return ok(row)
  }

  static async deleteReward(db: DB, merchantId: string, id: string) {
    await this.assertReward(db, merchantId, id)
    await db
      .delete(loyaltyRewards)
      .where(and(eq(loyaltyRewards.id, id), eq(loyaltyRewards.merchantId, merchantId)))
    return ok({ deleted: true })
  }

  private static async assertReward(db: DB, merchantId: string, id: string) {
    const [row] = await db
      .select()
      .from(loyaltyRewards)
      .where(and(eq(loyaltyRewards.id, id), eq(loyaltyRewards.merchantId, merchantId)))
    if (!row) throw notFound('REWARD_NOT_FOUND', 'Reward not found')
    return row
  }
}