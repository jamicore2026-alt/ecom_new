import { and, count, desc, eq, ilike, inArray } from 'drizzle-orm'
import { db } from '../../database/client'
import { coupons, promotions } from '../../database/schema'
import { makeMeta, parsePagination } from '../../shared/pagination'
import { roundForCurrency } from '../../shared/currency'
import { ok } from '../../shared/response'
import { badRequest, conflict, notFound } from '../../shared/errors'

type PromotionScope = 'all' | 'products' | 'category'

const toDate = (v?: string | Date | null) => (v ? new Date(v) : null)

/** Percentage coupons must stay within (0, 100] — anything else is a config error. */
const assertCouponValue = (type: string, value: number) => {
  if (type === 'percentage' && (value <= 0 || value > 100)) {
    throw badRequest('BAD_REQUEST', 'Percentage coupon value must be between 1 and 100')
  }
}

export class DiscountsService {
  /* -------------------------------- coupons -------------------------------- */

  static async listCoupons(merchantId: string, q: { page?: string; limit?: string; search?: string; status?: string }) {
    const { page, limit, offset } = parsePagination(q)
    const conditions = [eq(coupons.merchantId, merchantId)]
    if (q.status) conditions.push(eq(coupons.status, q.status))
    if (q.search) conditions.push(ilike(coupons.code, `%${q.search.trim().toUpperCase()}%`))
    const where = and(...conditions)

    const [{ total }] = await db.select({ total: count() }).from(coupons).where(where)
    const items = await db
      .select()
      .from(coupons)
      .where(where)
      .orderBy(desc(coupons.createdAt))
      .limit(limit)
      .offset(offset)

    return ok({ items, meta: makeMeta(page, limit, Number(total)) })
  }

  static async getCoupon(merchantId: string, id: string) {
    const [coupon] = await db
      .select()
      .from(coupons)
      .where(and(eq(coupons.id, id), eq(coupons.merchantId, merchantId)))
    if (!coupon) throw notFound('NOT_FOUND', 'Coupon not found')
    return ok(coupon)
  }

  static async createCoupon(
    merchantId: string,
    input: {
      code: string
      type: string
      value: number
      minSubtotal?: number
      usageLimit?: number
      startsAt?: string
      endsAt?: string
      status?: string
    }
  ) {
    const code = input.code.trim().toUpperCase()
    const [existing] = await db
      .select()
      .from(coupons)
      .where(and(eq(coupons.merchantId, merchantId), eq(coupons.code, code)))
    if (existing) throw conflict('DUPLICATE', 'A coupon with this code already exists')

    assertCouponValue(input.type, input.value)

    const [created] = await db
      .insert(coupons)
      .values({
        merchantId,
        code,
        type: input.type,
        value: input.value,
        minSubtotal: input.minSubtotal ?? 0,
        usageLimit: input.usageLimit ?? null,
        startsAt: toDate(input.startsAt),
        endsAt: toDate(input.endsAt),
        status: input.status ?? 'active'
      })
      .returning()

    return ok(created)
  }

  static async updateCoupon(
    merchantId: string,
    id: string,
    input: {
      type?: string
      value?: number
      minSubtotal?: number
      usageLimit?: number
      startsAt?: string
      endsAt?: string
      status?: string
    }
  ) {
    const [coupon] = await db
      .select()
      .from(coupons)
      .where(and(eq(coupons.id, id), eq(coupons.merchantId, merchantId)))
    if (!coupon) throw notFound('NOT_FOUND', 'Coupon not found')

    if (input.type !== undefined && input.value !== undefined) {
      assertCouponValue(input.type, input.value)
    } else if (input.type !== undefined && input.type === 'percentage') {
      assertCouponValue(input.type, coupon.value)
    } else if (input.value !== undefined && coupon.type === 'percentage') {
      assertCouponValue(coupon.type, input.value)
    }

    const values: Record<string, unknown> = {}
    for (const key of ['type', 'value', 'minSubtotal', 'usageLimit', 'status'] as const) {
      if (input[key] !== undefined) values[key] = input[key]
    }
    if (input.startsAt !== undefined) values.startsAt = toDate(input.startsAt)
    if (input.endsAt !== undefined) values.endsAt = toDate(input.endsAt)

    if (Object.keys(values).length === 0) return ok(coupon)

    const [updated] = await db
      .update(coupons)
      .set(values)
      .where(and(eq(coupons.id, id), eq(coupons.merchantId, merchantId)))
      .returning()
    return ok(updated)
  }

  static async deleteCoupon(merchantId: string, id: string) {
    const [coupon] = await db
      .select()
      .from(coupons)
      .where(and(eq(coupons.id, id), eq(coupons.merchantId, merchantId)))
    if (!coupon) throw notFound('NOT_FOUND', 'Coupon not found')

    const [updated] = await db
      .update(coupons)
      .set({ status: 'disabled' })
      .where(and(eq(coupons.id, id), eq(coupons.merchantId, merchantId)))
      .returning()
    return ok(updated)
  }

  /* ------------------------------ promotions ------------------------------- */

  static async listPromotions(merchantId: string, q: { page?: string; limit?: string; status?: string }) {
    const { page, limit, offset } = parsePagination(q)
    const conditions = [eq(promotions.merchantId, merchantId)]
    if (q.status) conditions.push(eq(promotions.status, q.status))
    const where = and(...conditions)

    const [{ total }] = await db.select({ total: count() }).from(promotions).where(where)
    const items = await db
      .select()
      .from(promotions)
      .where(where)
      .orderBy(desc(promotions.createdAt))
      .limit(limit)
      .offset(offset)

    return ok({ items, meta: makeMeta(page, limit, Number(total)) })
  }

  static async getPromotion(merchantId: string, id: string) {
    const [promotion] = await db
      .select()
      .from(promotions)
      .where(and(eq(promotions.id, id), eq(promotions.merchantId, merchantId)))
    if (!promotion) throw notFound('NOT_FOUND', 'Promotion not found')
    return ok(promotion)
  }

  static async createPromotion(
    merchantId: string,
    input: {
      name: string
      type: string
      discountPercent: number
      appliesTo?: { scope: PromotionScope; productIds?: string[]; categoryId?: string }
      startsAt?: string
      endsAt?: string
      status?: string
    }
  ) {
    const [created] = await db
      .insert(promotions)
      .values({
        merchantId,
        name: input.name,
        type: input.type,
        discountPercent: input.discountPercent,
        appliesTo: input.appliesTo ?? ({ scope: 'all' } as const),
        startsAt: toDate(input.startsAt),
        endsAt: toDate(input.endsAt),
        status: input.status ?? 'active'
      })
      .returning()
    return ok(created)
  }

  static async updatePromotion(
    merchantId: string,
    id: string,
    input: {
      name?: string
      type?: string
      discountPercent?: number
      appliesTo?: { scope: PromotionScope; productIds?: string[]; categoryId?: string }
      startsAt?: string
      endsAt?: string
      status?: string
    }
  ) {
    const [promotion] = await db
      .select()
      .from(promotions)
      .where(and(eq(promotions.id, id), eq(promotions.merchantId, merchantId)))
    if (!promotion) throw notFound('NOT_FOUND', 'Promotion not found')

    const values: Record<string, unknown> = {}
    for (const key of ['name', 'type', 'discountPercent', 'appliesTo', 'status'] as const) {
      if (input[key] !== undefined) values[key] = input[key]
    }
    if (input.startsAt !== undefined) values.startsAt = toDate(input.startsAt)
    if (input.endsAt !== undefined) values.endsAt = toDate(input.endsAt)

    if (Object.keys(values).length === 0) return ok(promotion)

    const [updated] = await db
      .update(promotions)
      .set(values)
      .where(and(eq(promotions.id, id), eq(promotions.merchantId, merchantId)))
      .returning()
    return ok(updated)
  }

  static async deletePromotion(merchantId: string, id: string) {
    const [promotion] = await db
      .select()
      .from(promotions)
      .where(and(eq(promotions.id, id), eq(promotions.merchantId, merchantId)))
    if (!promotion) throw notFound('NOT_FOUND', 'Promotion not found')

    const [updated] = await db
      .update(promotions)
      .set({ status: 'disabled' })
      .where(and(eq(promotions.id, id), eq(promotions.merchantId, merchantId)))
      .returning()
    return ok(updated)
  }

  /* -------------------------------- validate -------------------------------- */

  static async validateCoupon(merchantId: string, code: string, subtotal: number, currency = 'USD') {
    const [coupon] = await db
      .select()
      .from(coupons)
      .where(
        and(
          eq(coupons.merchantId, merchantId),
          eq(coupons.code, code.trim().toUpperCase()),
          eq(coupons.status, 'active')
        )
      )
    if (!coupon) throw notFound('NOT_FOUND', 'Coupon not found or inactive')
    if (coupon.endsAt && coupon.endsAt < new Date()) {
      throw badRequest('EXPIRED', 'Coupon has expired')
    }
    if (coupon.startsAt && coupon.startsAt > new Date()) {
      throw badRequest('NOT_STARTED', 'Coupon is not active yet')
    }
    if (subtotal < coupon.minSubtotal) {
      throw badRequest('MIN_NOT_MET', `Minimum subtotal of ${coupon.minSubtotal} required`)
    }
    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      throw badRequest('USAGE_LIMIT', 'Coupon usage limit reached')
    }
    // Both types clamp to the subtotal — a discount can never exceed (or invert) the cart.
    const raw =
      coupon.type === 'percentage'
        ? subtotal * (coupon.value / 100)
        : coupon.type === 'fixed'
          ? coupon.value
          : 0
    const discount = Math.min(roundForCurrency(raw, currency), roundForCurrency(subtotal, currency))
    return ok({ coupon, discount, freeShipping: coupon.type === 'free_shipping' })
  }
}
