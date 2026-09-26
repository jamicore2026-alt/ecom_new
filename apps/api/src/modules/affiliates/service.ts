import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DB } from '../../database/client'
import { affiliates, referrals } from '../../database/schema'
import { ok } from '../../shared/response'
import { badRequest, notFound, unauthorized } from '../../shared/errors'
import { COMMISSION_STATUSES, type CommissionStatus } from '../../shared/types'
import { getMailer, renderEmail } from '../../shared/mailer'
import { createLogger } from '../../shared/logger'

const log = createLogger('affiliates-portal')

/** 24h signed magic-link tokens: base64url(affiliateId.merchantId.exp.sig). */
const PORTAL_TTL_MS = 24 * 60 * 60 * 1000

const portalSecret = () =>
  process.env.AFFILIATE_PORTAL_SECRET ?? process.env.ENCRYPTION_KEY ?? 'dev-affiliate-portal-secret'

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

const signPortalToken = (affiliateId: string, merchantId: string, exp: number): string => {
  const payload = `${affiliateId}.${merchantId}.${exp}`
  const sig = b64url(createHmac('sha256', portalSecret()).update(payload).digest())
  return `${b64url(Buffer.from(affiliateId))}.${b64url(Buffer.from(merchantId))}.${exp}.${sig}`
}

const verifyPortalToken = (token: string): { affiliateId: string; merchantId: string } => {
  const parts = token.split('.')
  if (parts.length !== 4) throw unauthorized('Invalid portal token')
  const [aB64, mB64, expRaw, sig] = parts
  const affiliateId = unb64url(aB64).toString('utf8')
  const merchantId = unb64url(mB64).toString('utf8')
  const exp = Number(expRaw)
  if (!affiliateId || !merchantId || !Number.isFinite(exp)) {
    throw unauthorized('Invalid portal token')
  }
  if (Date.now() > exp) throw unauthorized('Portal link has expired')
  const expected = b64url(
    createHmac('sha256', portalSecret()).update(`${affiliateId}.${merchantId}.${exp}`).digest()
  )
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw unauthorized('Invalid portal token')
  }
  return { affiliateId, merchantId }
}

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

  /* ------------------------------ portal ------------------------------ */

  /**
   * Request a magic login link: emailed to the affiliate's address, valid 24h.
   * The affiliate is resolved by email within the given merchant scope.
   */
  static async requestPortalLink(
    db: DB,
    input: { email: string; merchantId?: string; merchantSlug?: string }
  ) {
    const email = input.email.trim().toLowerCase()
    if (!email) throw badRequest('INVALID_EMAIL', 'Email is required')

    let merchantId = input.merchantId ?? null
    if (!merchantId && input.merchantSlug) {
      const { merchants } = await import('../../database/schema')
      const [m] = await db
        .select({ id: merchants.id })
        .from(merchants)
        .where(eq(merchants.slug, input.merchantSlug))
      merchantId = m?.id ?? null
    }
    if (!merchantId) throw badRequest('INVALID_MERCHANT', 'merchantId or merchantSlug is required')

    const [affiliate] = await db
      .select()
      .from(affiliates)
      .where(
        and(
          eq(affiliates.merchantId, merchantId),
          eq(affiliates.email, email),
          eq(affiliates.status, 'active')
        )
      )
    // Always return ok (no account enumeration) — only active affiliates get mail.
    if (!affiliate) return ok({ sent: true })

    const exp = Date.now() + PORTAL_TTL_MS
    const token = signPortalToken(affiliate.id, merchantId, exp)
    const portalBase = process.env.PUBLIC_WEB_URL ?? process.env.PUBLIC_STOREFRONT_URL ?? 'http://localhost:5478'
    const link = `${portalBase}/affiliate?token=${encodeURIComponent(token)}`
    try {
      const fromEmail = process.env.MAIL_FROM_FALLBACK ?? 'onboarding@resend.dev'
      const { merchants } = await import('../../database/schema')
      const [m] = await db.select({ name: merchants.name }).from(merchants).where(eq(merchants.id, merchantId))
      const storeName = m?.name ?? 'Our store'
      await getMailer().send({
        from: `${storeName} <${fromEmail}>`,
        to: affiliate.email,
        subject: `Your ${storeName} affiliate dashboard link`,
        html: renderEmail({
          title: 'Your affiliate dashboard',
          intro: `Hi ${affiliate.name}! Use the link below to view your referrals, commissions and payouts. It expires in 24 hours.`,
          storeName,
          cta: { label: 'Open my dashboard', url: link },
          footerNote: `If you didn't request this, ignore it. Link expires ${new Date(exp).toUTCString()}.`
        })
      })
    } catch (e) {
      log.error('portal link email failed', { affiliateId: affiliate.id, error: e })
    }
    // Return the token in non-production so e2e tests can follow the link
    // without a mailbox; production returns sent-only.
    return ok({ sent: true, ...(process.env.NODE_ENV === 'production' ? {} : { token, nonce: randomBytes(4).toString('hex') }) })
  }

  /** Resolve a portal token to the affiliate dashboard payload. */
  static async portalMe(db: DB, token: string) {
    const { affiliateId, merchantId } = verifyPortalToken(token)
    const [affiliate] = await db
      .select()
      .from(affiliates)
      .where(
        and(
          eq(affiliates.id, affiliateId),
          eq(affiliates.merchantId, merchantId),
          eq(affiliates.status, 'active')
        )
      )
    if (!affiliate) throw unauthorized('Affiliate not found or inactive')

    const rows = await db
      .select()
      .from(referrals)
      .where(and(eq(referrals.merchantId, merchantId), eq(referrals.affiliateId, affiliateId)))
      .orderBy(desc(referrals.createdAt))

    const sum = (status: string) =>
      Math.round(rows.filter((r) => r.commissionStatus === status).reduce((s, r) => s + Number(r.commissionAmount), 0) * 100) / 100
    const stats = {
      clicks: rows.filter((r) => r.conversionStatus === 'clicked').length,
      conversions: rows.filter((r) => r.conversionStatus === 'converted').length,
      pending: sum('pending'),
      approved: sum('approved'),
      paid: sum('paid'),
      totalEarned: Math.round(rows.reduce((s, r) => s + Number(r.commissionAmount), 0) * 100) / 100
    }
    const [{ clicks30 }] = await db
      .select({ clicks30: sql<number>`count(*)` })
      .from(referrals)
      .where(
        and(
          eq(referrals.merchantId, merchantId),
          eq(referrals.affiliateId, affiliateId),
          sql`${referrals.createdAt} > now() - interval '30 days'`
        )
      )
    return ok({
      affiliate: {
        id: affiliate.id,
        name: affiliate.name,
        email: affiliate.email,
        referralCode: affiliate.referralCode,
        commissionRate: Number(affiliate.commissionRate),
        status: affiliate.status
      },
      stats: { ...stats, eventsLast30Days: Number(clicks30) },
      referrals: rows.slice(0, 100),
      payouts: rows.filter((r) => r.commissionStatus === 'paid').slice(0, 100)
    })
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
