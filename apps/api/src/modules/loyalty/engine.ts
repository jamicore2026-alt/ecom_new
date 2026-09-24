import { randomUUID } from 'node:crypto'
import { and, asc, eq, gt, gte, inArray, sql } from 'drizzle-orm'
import type { DB } from '../../database/client'
import {
  customers,
  loyaltyAccounts,
  loyaltyEarningRules,
  loyaltyLedger,
  loyaltyRewards,
  loyaltyTiers,
  type LoyaltyAccount,
  type LoyaltyEntry
} from '../../database/schema'
import { badRequest, notFound } from '../../shared/errors'
import { ok } from '../../shared/response'

/**
 * Rule triggers treated as "purchase" triggers by {@link awardForOrder}.
 *
 * The earning-rules UI defaults new rules to `checkout` while older docs use
 * `purchase`, so both (plus the `order` alias) are honored. Any other trigger
 * (birthday, review, referral, …) is intentionally ignored here — those are
 * fired by their own flows, not by order placement.
 */
export const ORDER_TRIGGERS = ['purchase', 'checkout', 'order'] as const

export type AwardForOrderInput = {
  customerId?: string | null
  orderId: string
  /** Order subtotal in the merchant's minor currency unit. Only used by `percent` rules. */
  subtotal: number
}

export type RedeemRewardInput = { customerId: string; rewardId: string }

export type AwardForOrderResult = {
  awarded: number
  skipped: boolean
  idempotent: boolean
  reason?: 'NO_CUSTOMER'
  account: LoyaltyAccount | null
  entries: LoyaltyEntry[]
  tierChanged: { from: string; to: string } | null
}

const pointsForRule = (awardType: string, awardValue: number, subtotal: number): number => {
  if (awardType === 'percent') return Math.floor(Math.max(0, subtotal) * (awardValue / 100))
  if (awardType === 'points') return Math.max(0, Math.floor(awardValue))
  return 0
}

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0]

async function assertCustomerScoped(tx: Tx, merchantId: string, customerId: string) {
  const [customer] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.merchantId, merchantId)))
    .limit(1)
  if (!customer) throw notFound('CUSTOMER_NOT_FOUND', 'Customer not found')
}

/**
 * Award loyalty points for a placed order.
 *
 * - No-op when there is no customer (guest checkout).
 * - Idempotent per orderId: skips when an `earn` ledger row with
 *   `reference = orderId` already exists for the merchant.
 * - Applies every enabled purchase-trigger rule: `points` awards a fixed
 *   amount, `percent` awards `floor(subtotal * awardValue / 100)`.
 * - Writes one `earn` ledger row per applied rule (reference = orderId),
 *   bumps each rule's `triggerCount`, then recomputes the member tier as the
 *   highest tier with `minPoints <= lifetimePoints`.
 *
 * Tier-change note: the shared `LOYALTY_LEDGER_TYPES` list has no `tier_up`
 * type, so tier changes are recorded as a zero-point `adjust` entry whose
 * meta carries `{ event: 'tier_up', fromTier, toTier }` instead of inventing
 * a new ledger type.
 */
export async function awardForOrder(db: DB, merchantId: string, input: AwardForOrderInput) {
  const { customerId, orderId, subtotal } = input
  if (!customerId) {
    return ok<AwardForOrderResult>({
      awarded: 0,
      skipped: true as const,
      idempotent: false as const,
      reason: 'NO_CUSTOMER' as const,
      account: null,
      entries: [],
      tierChanged: null
    })
  }
  if (!orderId) throw badRequest('BAD_REQUEST', 'orderId is required')

  return db.transaction(async (tx) => {
    await assertCustomerScoped(tx, merchantId, customerId)

    const [duplicate] = await tx
      .select({ id: loyaltyLedger.id })
      .from(loyaltyLedger)
      .where(
        and(
          eq(loyaltyLedger.merchantId, merchantId),
          eq(loyaltyLedger.type, 'earn'),
          eq(loyaltyLedger.reference, orderId)
        )
      )
      .limit(1)

    let [account] = await tx
      .select()
      .from(loyaltyAccounts)
      .where(and(eq(loyaltyAccounts.merchantId, merchantId), eq(loyaltyAccounts.customerId, customerId)))
      .limit(1)
    if (!account) {
      const [created] = await tx
        .insert(loyaltyAccounts)
        .values({ merchantId, customerId, points: 0, lifetimePoints: 0, tier: 'standard' })
        .onConflictDoNothing({ target: [loyaltyAccounts.merchantId, loyaltyAccounts.customerId] })
        .returning()
      if (created) {
        account = created
      } else {
        const [row] = await tx
          .select()
          .from(loyaltyAccounts)
          .where(and(eq(loyaltyAccounts.merchantId, merchantId), eq(loyaltyAccounts.customerId, customerId)))
          .limit(1)
        account = row
      }
    }

    if (duplicate) {
      return ok<AwardForOrderResult>({ awarded: 0, skipped: false as const, idempotent: true as const, account, entries: [], tierChanged: null })
    }

    const rules = await tx
      .select()
      .from(loyaltyEarningRules)
      .where(
        and(
          eq(loyaltyEarningRules.merchantId, merchantId),
          eq(loyaltyEarningRules.enabled, true),
          inArray(loyaltyEarningRules.trigger, [...ORDER_TRIGGERS])
        )
      )

    const awards = rules
      .map((rule) => ({ rule, points: pointsForRule(rule.awardType, rule.awardValue, subtotal) }))
      .filter((a) => a.points > 0)
    const total = awards.reduce((sum, a) => sum + a.points, 0)

    let current = account
    let entries: (typeof loyaltyLedger.$inferSelect)[] = []
    if (total > 0) {
      const [updated] = await tx
        .update(loyaltyAccounts)
        .set({
          points: sql`${loyaltyAccounts.points} + ${total}`,
          lifetimePoints: sql`${loyaltyAccounts.lifetimePoints} + ${total}`
        })
        .where(and(eq(loyaltyAccounts.id, account.id), eq(loyaltyAccounts.merchantId, merchantId)))
        .returning()
      current = updated

      for (const { rule, points } of awards) {
        const [entry] = await tx
          .insert(loyaltyLedger)
          .values({
            merchantId,
            customerId,
            type: 'earn',
            points,
            balanceAfter: updated.points,
            reference: orderId,
            meta: {
              ruleId: rule.id,
              ruleName: rule.name,
              awardType: rule.awardType,
              awardValue: rule.awardValue,
              subtotal
            }
          })
          .returning()
        entries.push(entry)
        await tx
          .update(loyaltyEarningRules)
          .set({ triggerCount: sql`${loyaltyEarningRules.triggerCount} + 1` })
          .where(and(eq(loyaltyEarningRules.id, rule.id), eq(loyaltyEarningRules.merchantId, merchantId)))
      }
    }

    // Recompute tier: highest tier with minPoints <= lifetimePoints.
    const tiers = await tx
      .select()
      .from(loyaltyTiers)
      .where(eq(loyaltyTiers.merchantId, merchantId))
      .orderBy(asc(loyaltyTiers.minPoints))
    const eligible = tiers.filter((t) => t.minPoints <= current.lifetimePoints).pop()
    let tierChanged: { from: string; to: string } | null = null
    if (eligible && eligible.name !== current.tier) {
      const from = current.tier
      const [updated] = await tx
        .update(loyaltyAccounts)
        .set({ tier: eligible.name })
        .where(and(eq(loyaltyAccounts.id, current.id), eq(loyaltyAccounts.merchantId, merchantId)))
        .returning()
      current = updated
      tierChanged = { from, to: eligible.name }
      const [tierEntry] = await tx
        .insert(loyaltyLedger)
        .values({
          merchantId,
          customerId,
          type: 'adjust',
          points: 0,
          balanceAfter: updated.points,
          reference: orderId,
          meta: { event: 'tier_up', fromTier: from, toTier: eligible.name, lifetimePoints: updated.lifetimePoints }
        })
        .returning()
      entries = [...entries, tierEntry]
    }

    return ok<AwardForOrderResult>({ awarded: total, skipped: false as const, idempotent: false as const, account: current, entries, tierChanged })
  })
}

/**
 * Redeem a catalog reward for a customer.
 *
 * Validates the reward is active, decrements stock when limited (conditional
 * UPDATE so concurrent redemptions cannot oversell), checks the point balance
 * (400 INSUFFICIENT_POINTS when short), debits the account, and writes a
 * `redeem` ledger row.
 *
 * Benefit note: rewards carry no discount-value mapping (no amount/percent
 * fields), so minting a coupon via DiscountsService would fabricate a value.
 * Redemption is therefore ledger-only: the response returns a unique
 * redemption code (also stored in the ledger meta) that staff honor at
 * fulfillment time.
 */
export async function redeemReward(db: DB, merchantId: string, input: RedeemRewardInput) {
  const { customerId, rewardId } = input
  if (!customerId) throw badRequest('BAD_REQUEST', 'customerId is required')
  if (!rewardId) throw badRequest('BAD_REQUEST', 'rewardId is required')

  return db.transaction(async (tx) => {
    const [reward] = await tx
      .select()
      .from(loyaltyRewards)
      .where(and(eq(loyaltyRewards.id, rewardId), eq(loyaltyRewards.merchantId, merchantId)))
      .limit(1)
    if (!reward) throw notFound('REWARD_NOT_FOUND', 'Reward not found')
    if (reward.status !== 'active') throw badRequest('REWARD_INACTIVE', 'Reward is not active')
    if (reward.stock !== null && reward.stock <= 0) throw badRequest('REWARD_OUT_OF_STOCK', 'Reward is out of stock')

    await assertCustomerScoped(tx, merchantId, customerId)

    let [account] = await tx
      .select()
      .from(loyaltyAccounts)
      .where(and(eq(loyaltyAccounts.merchantId, merchantId), eq(loyaltyAccounts.customerId, customerId)))
      .limit(1)
    if (!account) {
      const [created] = await tx
        .insert(loyaltyAccounts)
        .values({ merchantId, customerId, points: 0, lifetimePoints: 0, tier: 'standard' })
        .onConflictDoNothing({ target: [loyaltyAccounts.merchantId, loyaltyAccounts.customerId] })
        .returning()
      if (created) {
        account = created
      } else {
        const [row] = await tx
          .select()
          .from(loyaltyAccounts)
          .where(and(eq(loyaltyAccounts.merchantId, merchantId), eq(loyaltyAccounts.customerId, customerId)))
          .limit(1)
        account = row
      }
    }

    const cost = reward.pointsCost ?? 0
    if (account.points < cost) {
      throw badRequest('INSUFFICIENT_POINTS', 'Customer does not have enough loyalty points')
    }

    let stockRemaining: number | null = null
    if (reward.stock !== null) {
      const [decremented] = await tx
        .update(loyaltyRewards)
        .set({ stock: sql`${loyaltyRewards.stock} - 1` })
        .where(and(eq(loyaltyRewards.id, reward.id), eq(loyaltyRewards.merchantId, merchantId), gt(loyaltyRewards.stock, 0)))
        .returning()
      if (!decremented) throw badRequest('REWARD_OUT_OF_STOCK', 'Reward is out of stock')
      stockRemaining = decremented.stock
    }

    const [updated] = await tx
      .update(loyaltyAccounts)
      .set({ points: sql`${loyaltyAccounts.points} - ${cost}` })
      .where(
        and(
          eq(loyaltyAccounts.id, account.id),
          eq(loyaltyAccounts.merchantId, merchantId),
          gte(loyaltyAccounts.points, cost)
        )
      )
      .returning()
    if (!updated) throw badRequest('INSUFFICIENT_POINTS', 'Customer does not have enough loyalty points')

    const redemptionCode = `LYLT-${randomUUID().slice(0, 8).toUpperCase()}`
    const [entry] = await tx
      .insert(loyaltyLedger)
      .values({
        merchantId,
        customerId,
        type: 'redeem',
        points: -cost,
        balanceAfter: updated.points,
        reference: reward.id,
        meta: {
          rewardId: reward.id,
          rewardName: reward.name,
          rewardType: reward.type,
          redemptionCode
        }
      })
      .returning()

    return ok({
      account: updated,
      entry,
      benefit: {
        code: redemptionCode,
        rewardId: reward.id,
        rewardName: reward.name,
        rewardType: reward.type,
        customerId
      },
      redemptionCode,
      stockRemaining
    })
  })
}

/**
 * Expire stale point balances.
 *
 * Design choice (schema has no per-rule/per-entry expiry): an account is
 * stale when it still holds points (`points > 0`) but has no `earn` entry
 * newer than `olderThanDays` (default 365). Stale balances are zeroed with a
 * single `expire` ledger row (`points = -balance`, `balanceAfter = 0`, meta
 * `{ reason: 'stale_inactivity', olderThanDays, expiredPoints }`).
 * `lifetimePoints` (history) and `tier` (derived from lifetime) are left
 * untouched. Manually adjusted (`adjust`) credit is out of scope — only
 * earned points age out.
 */
export async function expireStaleAccounts(db: DB, merchantId: string, olderThanDays = 365) {
  if (!Number.isFinite(olderThanDays) || olderThanDays < 1) {
    throw badRequest('BAD_REQUEST', 'olderThanDays must be a positive number of days')
  }
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)

  const stale = await db
    .select()
    .from(loyaltyAccounts)
    .where(
      and(
        eq(loyaltyAccounts.merchantId, merchantId),
        gt(loyaltyAccounts.points, 0),
        sql`NOT EXISTS (
          SELECT 1 FROM ${loyaltyLedger} AS "earn_check"
          WHERE "earn_check"."merchant_id" = ${loyaltyAccounts.merchantId}
            AND "earn_check"."customer_id" = ${loyaltyAccounts.customerId}
            AND "earn_check"."type" = 'earn'
            AND "earn_check"."created_at" > ${cutoff.toISOString()}::timestamptz
        )`
      )
    )

  const expired: Array<{ customerId: string; expiredPoints: number; entryId: string }> = []
  for (const acct of stale) {
    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(loyaltyAccounts)
        .set({ points: 0 })
        .where(
          and(
            eq(loyaltyAccounts.id, acct.id),
            eq(loyaltyAccounts.merchantId, merchantId),
            gt(loyaltyAccounts.points, 0)
          )
        )
        .returning()
      if (!updated) return null
      const [entry] = await tx
        .insert(loyaltyLedger)
        .values({
          merchantId,
          customerId: acct.customerId,
          type: 'expire',
          points: -acct.points,
          balanceAfter: 0,
          reference: null,
          meta: { reason: 'stale_inactivity', olderThanDays, expiredPoints: acct.points }
        })
        .returning()
      return { customerId: acct.customerId, expiredPoints: acct.points, entryId: entry.id }
    })
    if (result) expired.push(result)
  }

  return ok({ expired, count: expired.length, olderThanDays, cutoff: cutoff.toISOString() })
}

export const LoyaltyEngine = { awardForOrder, redeemReward, expireStaleAccounts }
