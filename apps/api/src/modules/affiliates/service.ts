import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../database/client'
import { affiliates, referrals } from '../../database/schema'
import { ok } from '../../shared/response'
import { badRequest } from '../../shared/errors'

export class AffiliatesService {
  static async list(merchantId: string) {
    const rows = await db
      .select()
      .from(affiliates)
      .where(eq(affiliates.merchantId, merchantId))
      .orderBy(desc(affiliates.createdAt))
    return ok({ items: rows })
  }

  static async create(
    merchantId: string,
    input: { name: string; email: string; referralCode: string; commissionRate: number }
  ) {
    // Normalize referral code to uppercase alphanumeric.
    const code = input.referralCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 30)
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

  static async referrals(merchantId: string, affiliateId: string) {
    const rows = await db
      .select()
      .from(referrals)
      .where(and(eq(referrals.merchantId, merchantId), eq(referrals.affiliateId, affiliateId)))
      .orderBy(desc(referrals.createdAt))
    return ok({ items: rows })
  }
}
