import { and, count, desc, eq, ilike } from 'drizzle-orm'
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

export interface PromoLine {
  productId: string
  categoryId: string | null
  price: number
  quantity: number
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

  /**
   * Resolve the single best active promotion for a cart (P0-05).
   * Deterministic: highest computed discount wins; ties break on creation order.
   * Never trusts client-supplied discount totals — everything is recomputed here.
   */
  static async resolvePromotion(
    merchantId: string,
    currency: string,
    lines: PromoLine[]
  ): Promise<{ promotion: typeof promotions.$inferSelect; discount: number } | null> {
    const now = new Date()
    const rows = await db
      .select()
      .from(promotions)
      .where(and(eq(promotions.merchantId, merchantId), eq(promotions.status, 'active')))

    let best: { promotion: typeof promotions.$inferSelect; discount: number } | null = null
    for (const promotion of rows) {
      if (promotion.startsAt && promotion.startsAt > now) continue // future
      if (promotion.endsAt && promotion.endsAt < now) continue // expired
      if (promotion.usageLimit != null && promotion.usedCount >= promotion.usageLimit) continue // exhausted

      const matched = lines.filter((l) => {
        const scope = promotion.appliesTo ?? { scope: 'all' as const }
        if (scope.scope === 'products') return scope.productIds?.includes(l.productId) ?? false
        if (scope.scope === 'category')
          return !!scope.categoryId && scope.categoryId === l.categoryId
        return true
      })
      if (!matched.length) continue

      const subtotal = matched.reduce((s, l) => s + roundForCurrency(l.price * l.quantity, currency), 0)
      if (subtotal <= 0) continue

      let discount: number
      if (promotion.type === 'buy_x_get_y') {
        // Every (buyQty+getQty)-th unit across matched lines gets discountPercent
        // off — cheapest units are discounted first so the merchant's intent
        // ("buy 2 get 1 half price") is applied deterministically.
        const groupSize = Math.max(2, promotion.buyQty + Math.max(1, promotion.getQty))
        const unitPrices: number[] = []
        for (const l of matched) {
          for (let i = 0; i < l.quantity; i++) unitPrices.push(roundForCurrency(l.price, currency))
        }
        unitPrices.sort((a, b) => a - b)
        const freeUnits = Math.floor(unitPrices.length / groupSize) * Math.max(1, promotion.getQty)
        discount = unitPrices
          .slice(0, freeUnits)
          .reduce((s, p) => s + roundForCurrency(p * (promotion.discountPercent / 100), currency), 0)
      } else {
        // discount_on_products — percentage off the matched lines' subtotal.
        discount = subtotal * (promotion.discountPercent / 100)
      }

      discount = Math.min(Math.max(0, roundForCurrency(discount, currency)), subtotal)
      if (!best || discount > best.discount) best = { promotion, discount }
    }
    return best
  }

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
      buyQty?: number
      getQty?: number
      appliesTo?: { scope: PromotionScope; productIds?: string[]; categoryId?: string }
      startsAt?: string
      endsAt?: string
      usageLimit?: number | null
      status?: string
    }
  ) {
    if (input.discountPercent <= 0 || input.discountPercent > 100) {
      throw badRequest('BAD_REQUEST', 'Discount percent must be between 1 and 100')
    }
    const [created] = await db
      .insert(promotions)
      .values({
        merchantId,
        name: input.name,
        type: input.type,
        discountPercent: input.discountPercent,
        buyQty: Math.max(1, Math.floor(input.buyQty ?? 2)),
        getQty: Math.max(1, Math.floor(input.getQty ?? 1)),
        appliesTo: input.appliesTo ?? ({ scope: 'all' } as const),
        startsAt: toDate(input.startsAt),
        endsAt: toDate(input.endsAt),
        usageLimit: input.usageLimit ?? null,
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
      buyQty?: number
      getQty?: number
      appliesTo?: { scope: PromotionScope; productIds?: string[]; categoryId?: string }
      startsAt?: string
      endsAt?: string
      usageLimit?: number | null
      status?: string
    }
  ) {
    const [promotion] = await db
      .select()
      .from(promotions)
      .where(and(eq(promotions.id, id), eq(promotions.merchantId, merchantId)))
    if (!promotion) throw notFound('NOT_FOUND', 'Promotion not found')

    if (input.discountPercent !== undefined && (input.discountPercent <= 0 || input.discountPercent > 100)) {
      throw badRequest('BAD_REQUEST', 'Discount percent must be between 1 and 100')
    }

    const values: Record<string, unknown> = {}
    for (const key of ['name', 'type', 'discountPercent', 'appliesTo', 'status'] as const) {
      if (input[key] !== undefined) values[key] = input[key]
    }
    if (input.buyQty !== undefined) values.buyQty = Math.max(1, Math.floor(input.buyQty))
    if (input.getQty !== undefined) values.getQty = Math.max(1, Math.floor(input.getQty))
    if (input.usageLimit !== undefined) values.usageLimit = input.usageLimit
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
