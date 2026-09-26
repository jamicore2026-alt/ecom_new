import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm'
import type { DB } from '../../database/client'
import { couponRedemptions, coupons, customers, orders, promotions } from '../../database/schema'
import { makeMeta, parsePagination } from '../../shared/pagination'
import { roundForCurrency } from '../../shared/currency'
import { ok } from '../../shared/response'
import { badRequest, conflict, notFound } from '../../shared/errors'

type PromotionScope = 'all' | 'products' | 'category'

export type CouponScope = 'all' | 'products' | 'category' | 'customers'

export interface CouponAppliesTo {
  scope: CouponScope
  productIds?: string[]
  categoryId?: string
  customerIds?: string[]
}

export interface CouponInput {
  code: string
  type: string
  value: number
  minSubtotal?: number
  usageLimit?: number
  startsAt?: string
  endsAt?: string
  status?: string
  appliesTo?: CouponAppliesTo
  perCustomerLimit?: number | null
  firstOrderOnly?: boolean
  stackable?: boolean
  priority?: number
}

export interface CouponUpdateInput {
  type?: string
  value?: number
  minSubtotal?: number
  usageLimit?: number
  startsAt?: string
  endsAt?: string
  status?: string
  appliesTo?: CouponAppliesTo
  perCustomerLimit?: number | null
  firstOrderOnly?: boolean
  stackable?: boolean
  priority?: number
}

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

  static async listCoupons(db: DB, merchantId: string, q: { page?: string; limit?: string; search?: string; status?: string }) {
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

  static async getCoupon(db: DB, merchantId: string, id: string) {
    const [coupon] = await db
      .select()
      .from(coupons)
      .where(and(eq(coupons.id, id), eq(coupons.merchantId, merchantId)))
    if (!coupon) throw notFound('NOT_FOUND', 'Coupon not found')
    return ok(coupon)
  }

  static async createCoupon(
    db: DB,
    merchantId: string,
    input: CouponInput
  ) {
    const code = input.code.trim().toUpperCase()
    const [existing] = await db
      .select()
      .from(coupons)
      .where(and(eq(coupons.merchantId, merchantId), eq(coupons.code, code)))
    if (existing) throw conflict('DUPLICATE', 'A coupon with this code already exists')

    assertCouponValue(input.type, input.value)
    assertCouponScope(input.appliesTo)

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
        status: input.status ?? 'active',
        appliesTo: (input.appliesTo ?? { scope: 'all' }) as CouponAppliesTo,
        perCustomerLimit: input.perCustomerLimit ?? null,
        firstOrderOnly: input.firstOrderOnly ?? false,
        stackable: input.stackable ?? true,
        priority: input.priority ?? 0
      })
      .returning()

    return ok(created)
  }

  /**
   * Bulk-generate unique single-use codes from a base prefix (e.g. RECOVER-AB12CD…).
   * Each code gets usageLimit 1 unless overridden. Collisions retry with a new suffix.
   */
  static async bulkCreateCoupons(
    db: DB,
    merchantId: string,
    input: {
      prefix: string
      count: number
      type?: string
      value?: number
      minSubtotal?: number
      startsAt?: string
      endsAt?: string
      usageLimit?: number
      appliesTo?: CouponAppliesTo
      perCustomerLimit?: number | null
      firstOrderOnly?: boolean
      stackable?: boolean
      priority?: number
    }
  ) {
    const count = Math.floor(input.count)
    if (!Number.isFinite(count) || count < 1 || count > 500) {
      throw badRequest('BAD_REQUEST', 'Count must be between 1 and 500')
    }
    const prefix = (input.prefix || 'CODE').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20) || 'CODE'
    const type = input.type ?? 'fixed'
    const value = input.value ?? 0
    assertCouponValue(type, value)
    assertCouponScope(input.appliesTo)

    const created: Array<typeof coupons.$inferSelect> = []
    for (let i = 0; i < count; i++) {
      let code = ''
      for (let attempt = 0; attempt < 5; attempt++) {
        const suffix = randomSuffix(8)
        code = `${prefix}-${suffix}`
        const [dup] = await db
          .select({ id: coupons.id })
          .from(coupons)
          .where(and(eq(coupons.merchantId, merchantId), eq(coupons.code, code)))
        if (!dup) break
        code = ''
      }
      if (!code) throw badRequest('GENERATION_FAILED', 'Could not generate a unique code — retry')
      const [row] = await db
        .insert(coupons)
        .values({
          merchantId,
          code,
          type,
          value,
          minSubtotal: input.minSubtotal ?? 0,
          usageLimit: input.usageLimit ?? 1,
          startsAt: toDate(input.startsAt),
          endsAt: toDate(input.endsAt),
          status: 'active',
          appliesTo: (input.appliesTo ?? { scope: 'all' }) as CouponAppliesTo,
          perCustomerLimit: input.perCustomerLimit ?? 1,
          firstOrderOnly: input.firstOrderOnly ?? false,
          stackable: input.stackable ?? true,
          priority: input.priority ?? 0
        })
        .returning()
      created.push(row)
    }
    return ok({ items: created, count: created.length })
  }

  static async updateCoupon(
    db: DB,
    merchantId: string,
    id: string,
    input: CouponUpdateInput
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
    for (const key of ['type', 'value', 'minSubtotal', 'usageLimit', 'status', 'appliesTo', 'perCustomerLimit', 'firstOrderOnly', 'stackable', 'priority'] as const) {
      if (input[key] !== undefined) values[key] = input[key]
    }
    if (input.appliesTo !== undefined) assertCouponScope(input.appliesTo)
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

  static async deleteCoupon(db: DB, merchantId: string, id: string) {
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
    db: DB,
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

  static async listPromotions(db: DB, merchantId: string, q: { page?: string; limit?: string; status?: string }) {
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

  static async getPromotion(db: DB, merchantId: string, id: string) {
    const [promotion] = await db
      .select()
      .from(promotions)
      .where(and(eq(promotions.id, id), eq(promotions.merchantId, merchantId)))
    if (!promotion) throw notFound('NOT_FOUND', 'Promotion not found')
    return ok(promotion)
  }

  static async createPromotion(
    db: DB,
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
    db: DB,
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

  static async deletePromotion(db: DB, merchantId: string, id: string) {
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

  /**
   * Validate a coupon code against time/usage/scope/customer limits.
   *
   * Scope enforcement (coupons.appliesTo):
   * - products: at least one cart line must be in productIds (discount computed
   *   on the matched lines' subtotal, never the whole cart).
   * - category: at least one cart line must carry categoryId.
   * - customers: the redeeming customer (id or email) must be listed.
   * - all: no restriction.
   * When no cart lines are supplied for a product/category-scoped coupon the
   * discount falls back to the full subtotal but `scopeChecked` is false so
   * callers (checkout) know to re-validate with lines — checkout always passes
   * lines, the dashboard validate endpoint may not.
   */
  static async validateCoupon(
    db: DB,
    merchantId: string,
    code: string,
    subtotal: number,
    currency = 'USD',
    opts: {
      customerId?: string | null
      customerEmail?: string | null
      lines?: PromoLine[]
      /** Active promotion discount in the same checkout (for stackable checks). */
      promotionDiscount?: number
    } = {}
  ) {
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

    const scope = (coupon.appliesTo ?? { scope: 'all' }) as CouponAppliesTo
    let eligibleSubtotal = subtotal
    let scopeChecked = scope.scope === 'all'

    if (scope.scope === 'products' || scope.scope === 'category') {
      if (opts.lines && opts.lines.length > 0) {
        const matched = opts.lines.filter((l) => {
          if (scope.scope === 'products') return scope.productIds?.includes(l.productId) ?? false
          return !!scope.categoryId && scope.categoryId === l.categoryId
        })
        if (matched.length === 0) {
          throw badRequest('NOT_APPLICABLE', 'Coupon does not apply to any item in the cart')
        }
        eligibleSubtotal = matched.reduce(
          (s, l) => s + roundForCurrency(l.price * l.quantity, currency),
          0
        )
        scopeChecked = true
      }
    }

    if (scope.scope === 'customers') {
      const allowed = scope.customerIds ?? []
      const email = opts.customerEmail?.trim().toLowerCase() ?? null
      let customerEmail = email
      if (opts.customerId) {
        const [c] = await db
          .select({ id: customers.id, email: customers.email })
          .from(customers)
          .where(and(eq(customers.id, opts.customerId), eq(customers.merchantId, merchantId)))
        if (c) customerEmail = c.email.toLowerCase()
      }
      const okCustomer =
        (opts.customerId && allowed.includes(opts.customerId)) ||
        (customerEmail && allowed.some((idOrEmail) => idOrEmail.toLowerCase() === customerEmail))
      if (!okCustomer) {
        throw badRequest('NOT_APPLICABLE', 'Coupon is not available for this customer')
      }
      scopeChecked = true
    }

    // First-order-only: the customer must have zero paid orders.
    if (coupon.firstOrderOnly) {
      const ordersCount = await this.customerPaidOrders(db, merchantId, opts.customerId, opts.customerEmail)
      if (ordersCount > 0) {
        throw badRequest('FIRST_ORDER_ONLY', 'Coupon is valid for first orders only')
      }
    }

    // Per-customer limit via the coupon_redemptions ledger.
    if (coupon.perCustomerLimit != null && (opts.customerId || opts.customerEmail)) {
      const used = await this.customerRedemptionCount(
        db,
        coupon.id,
        opts.customerId ?? null,
        opts.customerEmail ?? null
      )
      if (used >= coupon.perCustomerLimit) {
        throw badRequest('CUSTOMER_LIMIT', 'You have already used this coupon the maximum number of times')
      }
    }

    // Both types clamp to the eligible subtotal — a discount can never exceed (or invert) the cart.
    const raw =
      coupon.type === 'percentage'
        ? eligibleSubtotal * (coupon.value / 100)
        : coupon.type === 'fixed'
          ? coupon.value
          : 0
    const discount = Math.min(
      roundForCurrency(raw, currency),
      roundForCurrency(eligibleSubtotal, currency)
    )

    // Non-stackable coupons cannot combine with a promotion: the checkout keeps
    // whichever side discounts more (ties prefer the higher coupon priority).
    const promotionDiscount = opts.promotionDiscount ?? 0
    const winner =
      promotionDiscount > 0
        ? this.pickStackWinner(
            { stackable: coupon.stackable, priority: coupon.priority },
            discount,
            promotionDiscount
          )
        : 'both'
    return ok({
      coupon,
      discount,
      freeShipping: coupon.type === 'free_shipping',
      scopeChecked,
      eligibleSubtotal: roundForCurrency(eligibleSubtotal, currency),
      stackWinner: winner
    })
  }

  /**
   * Decide which discount survives when a coupon and a promotion collide.
   * Returns 'both' when they may combine, otherwise the winning side.
   * Promotions carry no priority column, so a non-stackable coupon wins ties
   * only when its priority is positive.
   */
  static pickStackWinner(
    coupon: { stackable: boolean; priority: number },
    couponDiscount: number,
    promotionDiscount: number
  ): 'both' | 'coupon' | 'promotion' {
    if (coupon.stackable) return 'both'
    if (promotionDiscount <= 0 || couponDiscount <= 0) return 'both'
    if (couponDiscount > promotionDiscount) return 'coupon'
    if (promotionDiscount > couponDiscount) return 'promotion'
    return coupon.priority > 0 ? 'coupon' : 'promotion'
  }

  /** Number of paid orders for a customer (by id, falling back to email). */
  static async customerPaidOrders(
    db: DB,
    merchantId: string,
    customerId?: string | null,
    customerEmail?: string | null
  ): Promise<number> {
    let id = customerId ?? null
    if (!id && customerEmail) {
      const [c] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(eq(customers.merchantId, merchantId), eq(customers.email, customerEmail.trim().toLowerCase()))
        )
      id = c?.id ?? null
    }
    if (!id) {
      if (!customerEmail) return 0
      const [c] = await db
        .select({ ordersCount: customers.ordersCount })
        .from(customers)
        .where(
          and(eq(customers.merchantId, merchantId), eq(customers.email, customerEmail.trim().toLowerCase()))
        )
      return c?.ordersCount ?? 0
    }
    const [c] = await db
      .select({ ordersCount: customers.ordersCount })
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.merchantId, merchantId)))
    return c?.ordersCount ?? 0
  }

  /** Times this customer (id or email) has redeemed a coupon, per the ledger. */
  static async customerRedemptionCount(
    db: DB,
    couponId: string,
    customerId: string | null,
    customerEmail: string | null
  ): Promise<number> {
    const conditions = [eq(couponRedemptions.couponId, couponId)]
    const ors = []
    if (customerId) ors.push(eq(couponRedemptions.customerId, customerId))
    if (customerEmail) ors.push(eq(couponRedemptions.customerEmail, customerEmail.trim().toLowerCase()))
    if (ors.length === 0) return 0
    const rows = await db
      .select({ id: couponRedemptions.id })
      .from(couponRedemptions)
      .where(and(...conditions, or(...ors)))
    return rows.length
  }

  /**
   * Write a coupon_redemptions ledger row after a successful quota claim.
   * Call inside the checkout transaction right after the usedCount increment
   * (see storefront/service.ts createOrderTx). Never throws — a ledger failure
   * must not roll back an otherwise valid order; it logs via the caller.
   */
  static async recordRedemption(
    db: { insert: DB['insert'] },
    input: {
      merchantId: string
      couponId: string
      customerId?: string | null
      customerEmail?: string | null
      orderId?: string | null
    }
  ): Promise<void> {
    await db.insert(couponRedemptions).values({
      merchantId: input.merchantId,
      couponId: input.couponId,
      customerId: input.customerId ?? null,
      customerEmail: input.customerEmail?.trim().toLowerCase() ?? null,
      orderId: input.orderId ?? null
    })
  }

  /** Redemption report: per-code uses, customer reach, and discounted order values. */
  static async redemptionReport(db: DB, merchantId: string, couponId: string) {
    const [coupon] = await db
      .select()
      .from(coupons)
      .where(and(eq(coupons.id, couponId), eq(coupons.merchantId, merchantId)))
    if (!coupon) throw notFound('NOT_FOUND', 'Coupon not found')

    const redemptions = await db
      .select()
      .from(couponRedemptions)
      .where(
        and(eq(couponRedemptions.merchantId, merchantId), eq(couponRedemptions.couponId, couponId))
      )
      .orderBy(desc(couponRedemptions.createdAt))

    const orderIds = [...new Set(redemptions.map((r) => r.orderId).filter(Boolean))] as string[]
    let orderValue = 0
    let discountGiven = 0
    if (orderIds.length > 0) {
      // Filter in code to avoid dynamic inArray typing issues with empty sets.
      const wanted = new Set(orderIds)
      const linked = await db
        .select({ id: orders.id, total: orders.total, discountTotal: orders.discountTotal })
        .from(orders)
        .where(eq(orders.merchantId, merchantId))
      for (const o of linked) {
        if (!wanted.has(o.id)) continue
        orderValue += Number(o.total)
        discountGiven += Number(o.discountTotal)
      }
    }
    const uniqueCustomers = new Set(
      redemptions.map((r) => r.customerId ?? r.customerEmail ?? r.id)
    ).size

    return ok({
      coupon: { id: coupon.id, code: coupon.code, usedCount: coupon.usedCount },
      redemptions: redemptions.length,
      uniqueCustomers,
      orderValue: Math.round(orderValue * 100) / 100,
      discountGiven: Math.round(discountGiven * 100) / 100,
      items: redemptions.slice(0, 100)
    })
  }
}

const randomSuffix = (len: number) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const buf = new Uint8Array(len)
  crypto.getRandomValues(buf)
  return Array.from(buf)
    .map((b) => chars[b % chars.length])
    .join('')
}

const assertCouponScope = (appliesTo?: CouponAppliesTo) => {
  if (!appliesTo || appliesTo.scope === 'all') return
  if (appliesTo.scope === 'products' && (!appliesTo.productIds || appliesTo.productIds.length === 0)) {
    throw badRequest('BAD_REQUEST', 'Product-scoped coupons require at least one productId')
  }
  if (appliesTo.scope === 'category' && !appliesTo.categoryId) {
    throw badRequest('BAD_REQUEST', 'Category-scoped coupons require a categoryId')
  }
  if (appliesTo.scope === 'customers' && (!appliesTo.customerIds || appliesTo.customerIds.length === 0)) {
    throw badRequest('BAD_REQUEST', 'Customer-scoped coupons require at least one customer id or email')
  }
}
