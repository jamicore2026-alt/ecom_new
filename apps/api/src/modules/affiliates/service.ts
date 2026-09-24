import { and, desc, eq, inArray } from 'drizzle-orm'
import type { DB } from '../../database/client'
import { affiliates, referrals } from '../../database/schema'
import { ok } from '../../shared/response'
import { badRequest, notFound } from '../../shared/errors'
import { COMMISSION_STATUSES, type CommissionStatus } from '../../shared/types'

export type AttributeOrderInput = {
  orderId: string
  customerId?: string | null
  subtotal: number
  referralCode?: string | null
}

const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 30)

const roundMoney = (n: number) => Math.round(n * 1000) / 1000

export class AffiliatesService {
  static async list(db: DB, merchantId: string) {
    const rows = await db
      .select()
      .from(affiliates)
      .where(eq(affiliates.merchantId, merchantId))
      .orderBy(desc(affiliates.createdAt))
    return ok({ items: rows })
  }

  static async create(
    db: DB,
    merchantId: string,
    input: { name: string; email: string; referralCode: string; commissionRate: number }
  ) {
    // Normalize referral code to uppercase alphanumeric.
    const code = normalizeCode(input.referralCode)
    if (!code) throw badRequest('INVALID_CODE', 'Referral code is required and must be alphanumeric')

    const [row] = await db
      .insert(affiliates)
      .values({
        merchantId,
        name: input.name,
        email: input.email,
        referralCode: code,
        commissionRate: input.commissionRate.toString(),
        status: 'active'
      })
      .onConflictDoNothing({ target: [affiliates.merchantId, affiliates.referralCode] })
      .returning()
    if (!row) throw badRequest('AFFILIATE_EXISTS', 'An affiliate with this referral code already exists')
    return ok(row)
  }

  static async referrals(db: DB, merchantId: string, affiliateId: string) {
    const rows = await db
      .select()
      .from(referrals)
      .where(and(eq(referrals.merchantId, merchantId), eq(referrals.affiliateId, affiliateId)))
      .orderBy(desc(referrals.createdAt))
    return ok({ items: rows })
  }

  /**
   * Record an anonymous (or customer-linked) click for attribution.
   * The row stays at conversionStatus 'clicked' until attributeOrder converts it.
   */
  static async trackClick(
    db: DB,
    input: { code: string; customerId?: string | null; merchantId?: string }
  ) {
    const code = normalizeCode(input.code ?? '')
    if (!code) throw badRequest('INVALID_CODE', 'Referral code is required')

    const conditions = [eq(affiliates.referralCode, code), eq(affiliates.status, 'active')]
    if (input.merchantId) conditions.push(eq(affiliates.merchantId, input.merchantId))
    const matches = await db.select().from(affiliates).where(and(...conditions))
    if (matches.length === 0) throw notFound('AFFILIATE_NOT_FOUND', 'No active affiliate uses this referral code')
    // Codes are unique per merchant but may collide across merchants on the
    // public endpoint — refuse to guess and ask for merchant scope instead.
    if (matches.length > 1 && !input.merchantId) {
      throw badRequest('AMBIGUOUS_CODE', 'Referral code is ambiguous without merchant scope')
    }
    const affiliate = matches[0]

    const [row] = await db
      .insert(referrals)
      .values({
        merchantId: affiliate.merchantId,
        affiliateId: affiliate.id,
        customerId: input.customerId ?? null,
        orderId: null,
        conversionStatus: 'clicked',
        commissionAmount: 0,
        commissionStatus: 'pending',
        source: 'click'
      })
      .returning()
    return ok(row)
  }

  /**
   * Attribute an order to an affiliate code. Pure service function exported for
   * the storefront order hook (the hook wiring lives elsewhere).
   * Returns null data when there is no usable code/affiliate (no-op for the hook).
   */
  static async attributeOrder(db: DB, merchantId: string, input: AttributeOrderInput) {
    const code = normalizeCode(input.referralCode ?? '')
    if (!code) return ok(null)
    if (!input.orderId) throw badRequest('INVALID_ORDER', 'orderId is required')

    const [affiliate] = await db
      .select()
      .from(affiliates)
      .where(
        and(
          eq(affiliates.merchantId, merchantId),
          eq(affiliates.referralCode, code),
          eq(affiliates.status, 'active')
        )
      )
    // Unknown, foreign-merchant, or suspended code → silent no-op.
    if (!affiliate) return ok(null)

    // Idempotency: an order converts at most one commission per affiliate.
    const [existing] = await db
      .select()
      .from(referrals)
      .where(
        and(
          eq(referrals.merchantId, merchantId),
          eq(referrals.affiliateId, affiliate.id),
          eq(referrals.orderId, input.orderId)
        )
      )
    if (existing) return ok(existing)

    // Attribution window: prefer the most recent click row for this
    // affiliate/customer so the converted row keeps its source.
    const clickConditions = [
      eq(referrals.merchantId, merchantId),
      eq(referrals.affiliateId, affiliate.id),
      eq(referrals.conversionStatus, 'clicked')
    ]
    if (input.customerId) clickConditions.push(eq(referrals.customerId, input.customerId))
    const clicks = await db
      .select()
      .from(referrals)
      .where(and(...clickConditions))
      .orderBy(desc(referrals.createdAt))
      .limit(1)
    const source = clicks[0]?.source ?? 'code'

    const rate = Number(affiliate.commissionRate)
    const commissionAmount = roundMoney(Number(input.subtotal) * (Number.isFinite(rate) ? rate : 0) / 100)

    const [row] = await db
      .insert(referrals)
      .values({
        merchantId,
        affiliateId: affiliate.id,
        customerId: input.customerId ?? null,
        orderId: input.orderId,
        conversionStatus: 'converted',
        commissionAmount,
        commissionStatus: 'pending',
        source
      })
      .returning()
    return ok(row)
  }

  static assertCommissionStatus(value: string): asserts value is CommissionStatus {
    if (!(COMMISSION_STATUSES as readonly string[]).includes(value)) {
      throw badRequest('INVALID_STATUS', `Unknown commission status: ${value}`)
    }
  }

  private static async getReferral(db: DB, merchantId: string, referralId: string) {
    const [row] = await db
      .select()
      .from(referrals)
      .where(and(eq(referrals.id, referralId), eq(referrals.merchantId, merchantId)))
    if (!row) throw notFound('REFERRAL_NOT_FOUND', 'Referral not found')
    return row
  }

  /** pending → approved (marks the commission due). */
  static async approveReferral(db: DB, merchantId: string, referralId: string) {
    const row = await this.getReferral(db, merchantId, referralId)
    if (row.commissionStatus !== 'pending') {
      throw badRequest('INVALID_TRANSITION', `Only pending commissions can be approved (is ${row.commissionStatus})`)
    }
    const [updated] = await db
      .update(referrals)
      .set({ commissionStatus: 'approved' })
      .where(and(eq(referrals.id, referralId), eq(referrals.merchantId, merchantId)))
      .returning()
    return ok(updated)
  }

  /** pending/approved → cancelled. Paid commissions stay paid (manual handling). */
  static async cancelReferral(db: DB, merchantId: string, referralId: string, _reason?: string) {
    const row = await this.getReferral(db, merchantId, referralId)
    if (row.commissionStatus !== 'pending' && row.commissionStatus !== 'approved') {
      throw badRequest('INVALID_TRANSITION', `Only pending/approved commissions can be cancelled (is ${row.commissionStatus})`)
    }
    const [updated] = await db
      .update(referrals)
      .set({ commissionStatus: 'cancelled' })
      .where(and(eq(referrals.id, referralId), eq(referrals.merchantId, merchantId)))
      .returning()
    return ok(updated)
  }

  /**
   * Payout run: marks approved → paid, grouped per affiliate.
   * Affiliates whose approved total is below minPayout are skipped.
   */
  static async runPayout(
    db: DB,
    merchantId: string,
    input: { affiliateIds?: string[]; minPayout?: number } = {}
  ) {
    const minPayout = input.minPayout ?? 0
    const conditions = [eq(referrals.merchantId, merchantId), eq(referrals.commissionStatus, 'approved')]
    if (input.affiliateIds?.length) {
      conditions.push(inArray(referrals.affiliateId, input.affiliateIds))
    }
    const approved = await db
      .select()
      .from(referrals)
      .where(and(...conditions))

    const byAffiliate = new Map<string, { total: number; ids: string[] }>()
    for (const r of approved) {
      const cur = byAffiliate.get(r.affiliateId) ?? { total: 0, ids: [] }
      cur.total = roundMoney(cur.total + Number(r.commissionAmount))
      cur.ids.push(r.id)
      byAffiliate.set(r.affiliateId, cur)
    }

    const payouts: { affiliateId: string; total: number; count: number }[] = []
    const skipped: { affiliateId: string; total: number; count: number }[] = []
    for (const [affiliateId, group] of byAffiliate) {
      if (group.total < minPayout) {
        skipped.push({ affiliateId, total: group.total, count: group.ids.length })
        continue
      }
      await db
        .update(referrals)
        .set({ commissionStatus: 'paid' })
        .where(
          and(
            eq(referrals.merchantId, merchantId),
            eq(referrals.commissionStatus, 'approved'),
            inArray(referrals.id, group.ids)
          )
        )
      payouts.push({ affiliateId, total: group.total, count: group.ids.length })
    }

    const totalAmount = roundMoney(payouts.reduce((s, p) => s + p.total, 0))
    const totalCount = payouts.reduce((s, p) => s + p.count, 0)
    return ok({ payouts, skipped, totalAmount, totalCount })
  }

  /**
   * Refund reversal: commissions still pending/approved for the order → cancelled.
   * Already-paid commissions are left untouched for manual settlement.
   */
  static async reverseForRefund(db: DB, merchantId: string, orderId: string) {
    const rows = await db
      .select({ id: referrals.id })
      .from(referrals)
      .where(
        and(
          eq(referrals.merchantId, merchantId),
          eq(referrals.orderId, orderId),
          inArray(referrals.commissionStatus, ['pending', 'approved'])
        )
      )
    if (rows.length === 0) return ok({ reversed: 0 })
    await db
      .update(referrals)
      .set({ commissionStatus: 'cancelled' })
      .where(
        and(
          eq(referrals.merchantId, merchantId),
          eq(referrals.orderId, orderId),
          inArray(referrals.commissionStatus, ['pending', 'approved'])
        )
      )
    return ok({ reversed: rows.length })
  }
}

/**
 * Storefront order hook entrypoint (wiring lives in storefront/service.ts):
 * attribute an order's referral code to a converted commission row.
 */
export async function attributeOrder(db: DB, merchantId: string, input: AttributeOrderInput) {
  return AffiliatesService.attributeOrder(db, merchantId, input)
}

/** Refund hook entrypoint: cancel unpaid commissions for a refunded order. */
export async function reverseForRefund(db: DB, merchantId: string, orderId: string) {
  return AffiliatesService.reverseForRefund(db, merchantId, orderId)
}
