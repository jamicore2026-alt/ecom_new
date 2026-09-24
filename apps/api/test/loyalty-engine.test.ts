import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { db } from '../src/database/client'
import {
  customers,
  loyaltyAccounts,
  loyaltyEarningRules,
  loyaltyLedger,
  loyaltyRewards,
  loyaltyTiers,
  merchants
} from '../src/database/schema'
import { awardForOrder, expireStaleAccounts, redeemReward } from '../src/modules/loyalty/engine'
import { HttpError } from '../src/shared/errors'

let merchantId: string
let customerA: string
let customerB: string
const ruleIds: string[] = []
const tierIds: string[] = []
const rewardIds: string[] = []

const accountOf = async (customerId: string) => {
  const [row] = await db
    .select()
    .from(loyaltyAccounts)
    .where(and(eq(loyaltyAccounts.merchantId, merchantId), eq(loyaltyAccounts.customerId, customerId)))
  return row
}

const earnRows = (customerId: string, reference?: string) =>
  db
    .select()
    .from(loyaltyLedger)
    .where(
      and(
        eq(loyaltyLedger.merchantId, merchantId),
        eq(loyaltyLedger.customerId, customerId),
        eq(loyaltyLedger.type, 'earn'),
        ...(reference ? [eq(loyaltyLedger.reference, reference)] : [])
      )
    )

describe('Loyalty engine', () => {
  beforeAll(async () => {
    const [merchant] = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.slug, 'jamicore-store'))
    merchantId = merchant.id

    // Start from a clean loyalty slate (seed creates no loyalty fixtures).
    await db.delete(loyaltyLedger).where(eq(loyaltyLedger.merchantId, merchantId))
    await db.delete(loyaltyAccounts).where(eq(loyaltyAccounts.merchantId, merchantId))
    await db.delete(loyaltyEarningRules).where(eq(loyaltyEarningRules.merchantId, merchantId))
    await db.delete(loyaltyTiers).where(eq(loyaltyTiers.merchantId, merchantId))
    await db.delete(loyaltyRewards).where(eq(loyaltyRewards.merchantId, merchantId))

    const stamp = Date.now()
    const [a] = await db
      .insert(customers)
      .values({ merchantId, email: `loyalty-eng-a-${stamp}@test.com`, firstName: 'Loyal', lastName: 'A' })
      .returning({ id: customers.id })
    const [b] = await db
      .insert(customers)
      .values({ merchantId, email: `loyalty-eng-b-${stamp}@test.com`, firstName: 'Loyal', lastName: 'B' })
      .returning({ id: customers.id })
    customerA = a.id
    customerB = b.id
  })

  it('awards fixed + percent purchase rules and ignores disabled / non-purchase triggers', async () => {
    const mk = async (values: object) => {
      const [row] = await db.insert(loyaltyEarningRules).values({ merchantId, ...values } as never).returning()
      ruleIds.push(row.id)
      return row
    }
    const fixed = await mk({ name: 'Order fixed', trigger: 'purchase', awardType: 'points', awardValue: 10, enabled: true })
    const percent = await mk({ name: 'Order percent', trigger: 'purchase', awardType: 'percent', awardValue: 5, enabled: true })
    const disabled = await mk({ name: 'Disabled', trigger: 'purchase', awardType: 'points', awardValue: 999, enabled: false })
    const review = await mk({ name: 'Review', trigger: 'review', awardType: 'points', awardValue: 50, enabled: true })

    // Guest checkout (no customer) is a no-op.
    const guest = await awardForOrder(db, merchantId, { customerId: null, orderId: 'order-guest-1', subtotal: 2000 })
    expect(guest.success).toBe(true)
    if (guest.success) {
      expect(guest.data.awarded).toBe(0)
      expect(guest.data.skipped).toBe(true)
    }

    // subtotal 2000 → fixed 10 + floor(2000 * 5%) 100 = 110
    const res = await awardForOrder(db, merchantId, { customerId: customerA, orderId: 'order-eng-1', subtotal: 2000 })
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data.awarded).toBe(110)
    expect(res.data.account?.points).toBe(110)
    expect(res.data.account?.lifetimePoints).toBe(110)

    const rows = await earnRows(customerA, 'order-eng-1')
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.balanceAfter === 110)).toBe(true)

    const counts = await db.select().from(loyaltyEarningRules).where(eq(loyaltyEarningRules.merchantId, merchantId))
    expect(counts.find((r) => r.id === fixed.id)?.triggerCount).toBe(1)
    expect(counts.find((r) => r.id === percent.id)?.triggerCount).toBe(1)
    expect(counts.find((r) => r.id === disabled.id)?.triggerCount).toBe(0)
    expect(counts.find((r) => r.id === review.id)?.triggerCount).toBe(0)
  })

  it('is idempotent per orderId', async () => {
    const retry = await awardForOrder(db, merchantId, { customerId: customerA, orderId: 'order-eng-1', subtotal: 2000 })
    expect(retry.success).toBe(true)
    if (!retry.success) return
    expect(retry.data.awarded).toBe(0)
    expect(retry.data.idempotent).toBe(true)

    const rows = await earnRows(customerA, 'order-eng-1')
    expect(rows).toHaveLength(2)
    const acct = await accountOf(customerA)
    expect(acct.points).toBe(110)

    const counts = await db.select().from(loyaltyEarningRules).where(eq(loyaltyEarningRules.merchantId, merchantId))
    expect(counts.every((r) => (r.enabled && r.trigger === 'purchase' ? r.triggerCount === 1 : true))).toBe(true)
  })

  it('upgrades the tier to the highest qualifying tier with a tier_up ledger entry', async () => {
    for (const [name, minPoints] of [['bronze', 0], ['silver', 50], ['gold', 200]] as const) {
      const [tier] = await db.insert(loyaltyTiers).values({ merchantId, name, minPoints }).returning()
      tierIds.push(tier.id)
    }

    const res = await awardForOrder(db, merchantId, { customerId: customerB, orderId: 'order-eng-tier-1', subtotal: 2000 })
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data.awarded).toBe(110)
    expect(res.data.account?.tier).toBe('silver')
    expect(res.data.tierChanged).toEqual({ from: 'standard', to: 'silver' })

    const tierEntries = await db
      .select()
      .from(loyaltyLedger)
      .where(
        and(
          eq(loyaltyLedger.merchantId, merchantId),
          eq(loyaltyLedger.customerId, customerB),
          eq(loyaltyLedger.type, 'adjust')
        )
      )
    expect(tierEntries).toHaveLength(1)
    expect((tierEntries[0].meta as Record<string, unknown>).event).toBe('tier_up')
    expect((tierEntries[0].meta as Record<string, unknown>).toTier).toBe('silver')
  })

  it('redeems a reward: deducts points, decrements stock, returns a benefit code', async () => {
    const [reward] = await db
      .insert(loyaltyRewards)
      .values({ merchantId, name: 'Free mug', type: 'product', pointsCost: 30, status: 'active', stock: 5 })
      .returning()
    rewardIds.push(reward.id)

    const res = await redeemReward(db, merchantId, { customerId: customerA, rewardId: reward.id })
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data.account.points).toBe(80) // 110 - 30
    expect(res.data.entry.type).toBe('redeem')
    expect(res.data.entry.points).toBe(-30)
    expect(res.data.entry.balanceAfter).toBe(80)
    expect(res.data.redemptionCode).toMatch(/^LYLT-/)
    expect(res.data.benefit.code).toBe(res.data.redemptionCode)
    expect(res.data.stockRemaining).toBe(4)

    const [updated] = await db.select().from(loyaltyRewards).where(eq(loyaltyRewards.id, reward.id))
    expect(updated.stock).toBe(4)
  })

  it('rejects redemption with 400 when points are short, reward inactive, or out of stock', async () => {
    const [pricey] = await db
      .insert(loyaltyRewards)
      .values({ merchantId, name: 'Too pricey', type: 'product', pointsCost: 99999, status: 'active', stock: null })
      .returning()
    const [inactive] = await db
      .insert(loyaltyRewards)
      .values({ merchantId, name: 'Retired', type: 'product', pointsCost: 1, status: 'inactive', stock: null })
      .returning()
    const [empty] = await db
      .insert(loyaltyRewards)
      .values({ merchantId, name: 'Gone', type: 'product', pointsCost: 1, status: 'active', stock: 0 })
      .returning()
    rewardIds.push(pricey.id, inactive.id, empty.id)

    const attempt = async (rewardId: string) => {
      try {
        await redeemReward(db, merchantId, { customerId: customerA, rewardId })
        return null
      } catch (err) {
        return err as HttpError
      }
    }

    const short = await attempt(pricey.id)
    expect(short).toBeInstanceOf(HttpError)
    expect(short?.httpStatus).toBe(400)
    expect(short?.code).toBe('INSUFFICIENT_POINTS')

    const retired = await attempt(inactive.id)
    expect(retired?.httpStatus).toBe(400)
    expect(retired?.code).toBe('REWARD_INACTIVE')

    const gone = await attempt(empty.id)
    expect(gone?.httpStatus).toBe(400)
    expect(gone?.code).toBe('REWARD_OUT_OF_STOCK')

    // Failed attempts must not move the balance.
    expect((await accountOf(customerA)).points).toBe(80)
  })

  it('expires stale balances and keeps accounts with recent earns', async () => {
    const staleDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000)
    await db
      .update(loyaltyLedger)
      .set({ createdAt: staleDate })
      .where(and(eq(loyaltyLedger.merchantId, merchantId), eq(loyaltyLedger.customerId, customerA)))

    const res = await expireStaleAccounts(db, merchantId, 365)
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data.count).toBe(1)
    expect(res.data.expired[0].customerId).toBe(customerA)
    expect(res.data.expired[0].expiredPoints).toBe(80)

    const acctA = await accountOf(customerA)
    expect(acctA.points).toBe(0)
    expect(acctA.lifetimePoints).toBe(110) // history untouched

    const expireRows = await db
      .select()
      .from(loyaltyLedger)
      .where(
        and(
          eq(loyaltyLedger.merchantId, merchantId),
          eq(loyaltyLedger.customerId, customerA),
          eq(loyaltyLedger.type, 'expire')
        )
      )
    expect(expireRows).toHaveLength(1)
    expect(expireRows[0].points).toBe(-80)
    expect(expireRows[0].balanceAfter).toBe(0)
    expect((expireRows[0].meta as Record<string, unknown>).reason).toBe('stale_inactivity')

    // customerB earned recently (tier test) → untouched.
    expect((await accountOf(customerB)).points).toBe(110)
  })

  afterAll(async () => {
    await db.delete(loyaltyLedger).where(eq(loyaltyLedger.merchantId, merchantId))
    await db.delete(loyaltyAccounts).where(eq(loyaltyAccounts.merchantId, merchantId))
    await db.delete(loyaltyEarningRules).where(eq(loyaltyEarningRules.merchantId, merchantId))
    await db.delete(loyaltyTiers).where(eq(loyaltyTiers.merchantId, merchantId))
    await db.delete(loyaltyRewards).where(eq(loyaltyRewards.merchantId, merchantId))
    for (const id of [customerA, customerB]) {
      await db.delete(customers).where(and(eq(customers.id, id), eq(customers.merchantId, merchantId)))
    }
  })
})
