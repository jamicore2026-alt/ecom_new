import { and, count, desc, eq, gte, isNull, lt, lte } from 'drizzle-orm'
import type { DB } from '../../database/client'
import { carts, coupons, customers, merchants, orders, storeSettings } from '../../database/schema'
import { ok } from '../../shared/response'
import { notFound } from '../../shared/errors'
import { createLogger } from '../../shared/logger'
import { DiscountsService } from '../discounts/service'

const log = createLogger('carts')
import { getMailer, renderEmail } from '../../shared/mailer'

export type CartItem = {
  variantId: string
  productId?: string
  name: string
  price: number
  quantity: number
  image?: string | null
  slug?: string
}

export class CartsService {
  /** Persist a server-side snapshot of the shopper's cart. */
  static async saveCart(
    db: DB,
    slug: string,
    input: {
      cartId?: string
      customerId?: string
      items: CartItem[]
      email?: string
      recover?: string
    }
  ) {
    const [merchant] = await db
      .select()
      .from(merchants)
      .where(and(eq(merchants.slug, slug), eq(merchants.status, 'active')))
    if (!merchant) throw notFound('STORE_NOT_FOUND', 'Store not found')

    // Guest capture: when the client sends the shopper email (collected at
    // checkout) but no customerId, link the cart to the matching customer row
    // so recovery emails can reach them. Pure guests (no customer row) stay
    // unlinked and are skipped by the sweep (documented limitation).
    let customerId = input.customerId ?? null
    if (!customerId && input.email?.trim()) {
      const [match] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(eq(customers.merchantId, merchant.id), eq(customers.email, input.email.trim().toLowerCase()))
        )
      customerId = match?.id ?? null
    }

    // Prefer the client-held cart id, then fall back to the most recent cart
    // for the customer/email so guest carts stay stable across sessions.
    let existing: typeof carts.$inferSelect | undefined
    if (input.cartId) {
      const [byId] = await db
        .select()
        .from(carts)
        .where(and(eq(carts.id, input.cartId), eq(carts.merchantId, merchant.id)))
      existing = byId
    }
    if (!existing && customerId) {
      const [byCustomer] = await db
        .select()
        .from(carts)
        .where(and(eq(carts.merchantId, merchant.id), eq(carts.customerId, customerId)))
        .orderBy(desc(carts.createdAt))
        .limit(1)
      existing = byCustomer
    }

    if (existing) {
      const [updated] = await db
        .update(carts)
        .set({
          items: input.items as never,
          status: input.items.length > 0 ? 'active' : existing.status,
          customerId: customerId ?? existing.customerId,
          abandonedAt: null,
          lastActivityAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(carts.id, existing.id))
        .returning()
      return ok({ cart: updated })
    }

    const [cart] = await db
      .insert(carts)
      .values({
        merchantId: merchant.id,
        customerId,
        items: input.items as never,
        status: 'active',
        lastActivityAt: new Date()
      })
      .returning()

    return ok({ cart })
  }

  /** Mark a cart as abandoned + trigger recovery email. Returns count touched. */
  static async sweepAbandonedCarts(db: DB, abandonAfterMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = new Date(Date.now() - abandonAfterMs)

    const abandoned = await db
      .select()
      .from(carts)
      .where(
        and(
          eq(carts.status, 'active'),
          lt(carts.lastActivityAt, cutoff),
          isNull(carts.abandonedAt)
        )
      )
      .limit(100)

    let count = 0
    for (const cart of abandoned) {
      // Mark abandoned
      await db
        .update(carts)
        .set({ status: 'abandoned', abandonedAt: new Date() })
        .where(eq(carts.id, cart.id))

      // Look up customer for recovery email.
      // Guest capture limitation (documented): the carts table stores no email
      // column, so carts without a customerId cannot be emailed and are skipped.
      // The storefront already collects the shopper email at checkout — passing
      // customerId when saving the cart snapshot links recovery to that shopper.
      let customer: { id: string; email: string; marketingOptOut: boolean; lastOrderAt: Date | null } | null = null
      if (cart.customerId) {
        const [row] = await db
          .select({ id: customers.id, email: customers.email, marketingOptOut: customers.marketingOptOut, lastOrderAt: customers.lastOrderAt })
          .from(customers)
          .where(eq(customers.id, cart.customerId))
        customer = row ?? null
      }

      if (!customer) continue
      // Suppression: opted-out shoppers and recent purchasers never get nudged.
      if (customer.marketingOptOut) continue
      if (customer.lastOrderAt && customer.lastOrderAt > cutoff) continue

      await db
        .update(carts)
        .set({ recoveryCode: generateRecoveryCode(), recoverySentAt: new Date() })
        .where(eq(carts.id, cart.id))

      const [updated] = await db
        .select()
        .from(carts)
        .where(eq(carts.id, cart.id))

      await this.sendRecoveryEmail(db, cart.merchantId, customer.email, updated.recoveryCode as string, cart.items)
      count++
    }

    // Second touch runs in the same sweep (48h after the first touch).
    count += await this.sweepSecondTouch(db)

    return count
  }

  /**
   * Second touch (48h after the first recovery email): sends a follow-up with
   * a unique single-use coupon incentive generated per cart.
   * Persistence without a schema change: the incentive coupon code is
   * deterministic per cart (`RC-<cartId-suffix>`); a second touch is "sent"
   * when that coupon already exists. Converted carts are never re-touched.
   */
  static async sweepSecondTouch(db: DB): Promise<number> {
    const secondTouchAfter = new Date(Date.now() - 48 * 60 * 60 * 1000)
    const candidates = await db
      .select()
      .from(carts)
      .where(
        and(
          eq(carts.status, 'abandoned'),
          lte(carts.recoverySentAt, secondTouchAfter)
        )
      )
      .limit(50)

    let count = 0
    for (const cart of candidates) {
      try {
        if (!cart.customerId) continue
        const [customer] = await db
          .select({ id: customers.id, email: customers.email, marketingOptOut: customers.marketingOptOut, lastOrderAt: customers.lastOrderAt })
          .from(customers)
          .where(eq(customers.id, cart.customerId))
        if (!customer || customer.marketingOptOut) continue
        // Suppression: purchased since the first touch → skip.
        if (customer.lastOrderAt && cart.recoverySentAt && customer.lastOrderAt > cart.recoverySentAt) continue

        const incentiveCode = secondTouchCode(cart.id)
        const [existingCoupon] = await db
          .select({ id: coupons.id })
          .from(coupons)
          .where(and(eq(coupons.merchantId, cart.merchantId), eq(coupons.code, incentiveCode)))
        // Coupon exists → second touch already sent for this cart.
        if (existingCoupon) continue

        const items = parseCartItems(cart.items)
        if (items.length === 0) continue
        const subtotal = items.reduce((s, i) => s + Number(i.price) * Number(i.quantity), 0)

        const created = await DiscountsService.createCoupon(db, cart.merchantId, {
          code: incentiveCode,
          type: 'percentage',
          value: 10,
          minSubtotal: 0,
          usageLimit: 1,
          perCustomerLimit: 1,
          endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          stackable: false,
          priority: 10
        }).catch(() => null)
        if (!created) continue

        await this.sendRecoveryEmail(
          db,
          cart.merchantId,
          customer.email,
          (cart.recoveryCode ?? '') as string,
          cart.items,
          { incentiveCode, subtotal }
        )
        count++
      } catch (e) {
        log.error('second touch failed', { cartId: cart.id, error: e })
      }
    }
    return count
  }

  /** Recovered-revenue report: orders attributed via carts.recoveredOrderId. */
  static async recoveryReport(db: DB, merchantId: string) {
    const converted = await db
      .select({ recoveredOrderId: carts.recoveredOrderId })
      .from(carts)
      .where(and(eq(carts.merchantId, merchantId), eq(carts.status, 'converted')))
    const orderIds = [...new Set(converted.map((c) => c.recoveredOrderId).filter(Boolean))] as string[]

    let recoveredRevenue = 0
    let recoveredOrders = 0
    if (orderIds.length > 0) {
      const wanted = new Set(orderIds)
      const rows = await db
        .select({ id: orders.id, total: orders.total })
        .from(orders)
        .where(eq(orders.merchantId, merchantId))
      for (const r of rows) {
        if (!wanted.has(r.id)) continue
        recoveredRevenue += Number(r.total)
        recoveredOrders++
      }
    }

    const [abandonedRow] = await db
      .select({ total: count() })
      .from(carts)
      .where(and(eq(carts.merchantId, merchantId), eq(carts.status, 'abandoned')))
    const abandonedCarts = Number(abandonedRow?.total ?? 0)

    const emailedRows = await db
      .select({ id: carts.id })
      .from(carts)
      .where(
        and(
          eq(carts.merchantId, merchantId),
          eq(carts.status, 'abandoned'),
          gte(carts.recoverySentAt, new Date(0))
        )
      )
    const emailedCount = emailedRows.length

    return ok({
      recoveredOrders,
      recoveredRevenue: Math.round(recoveredRevenue * 100) / 100,
      abandonedCarts,
      emailedCarts: emailedCount,
      conversionRate: emailedCount > 0 ? Math.round((recoveredOrders / emailedCount) * 1000) / 10 : 0
    })
  }

  /** Recover a cart from a recovery code — restore the items (client revalidates stock). */
  static async recoverCart(db: DB, slug: string, recoveryCode: string, _customerId?: string) {
    const [merchant] = await db
      .select()
      .from(merchants)
      .where(and(eq(merchants.slug, slug), eq(merchants.status, 'active')))
    if (!merchant) throw notFound('STORE_NOT_FOUND', 'Store not found')

    const [cart] = await db
      .select()
      .from(carts)
      .where(
        and(eq(carts.merchantId, merchant.id), eq(carts.recoveryCode, recoveryCode))
      )
    if (!cart) throw notFound('CART_NOT_FOUND', 'Recovery link is invalid or expired')

    // Restore to active so it's not re-swept.
    await db
      .update(carts)
      .set({ status: 'active', abandonedAt: null, lastActivityAt: new Date(), updatedAt: new Date() })
      .where(eq(carts.id, cart.id))

    const [updated] = await db.select().from(carts).where(eq(carts.id, cart.id))

    return ok({
      cartId: updated.id,
      items: (updated.items as unknown as CartItem[]) ?? [],
      restored: true
    })
  }

  /** Record a completed checkout — mark any matching cart as converted. */
  static async markConverted(
    db: DB,
    merchantId: string,
    cartId: string | null | undefined,
    orderId: string
  ) {
    if (!cartId) return
    await db
      .update(carts)
      .set({ status: 'converted', recoveredOrderId: orderId, updatedAt: new Date() })
      .where(and(eq(carts.id, cartId), eq(carts.merchantId, merchantId)))
  }

  /** List carts for the merchant dashboard. */
  static async list(db: DB, merchantId: string, query: { status?: string; page?: string; limit?: string } = {}) {
    const page = Number(query.page ?? 1)
    const limit = Math.min(Number(query.limit ?? 50), 100)
    const offset = (page - 1) * limit

    const conditions = [eq(carts.merchantId, merchantId)]
    if (query.status && query.status !== 'all') {
      conditions.push(eq(carts.status, query.status))
    }

    const rows = await db
      .select()
      .from(carts)
      .where(and(...conditions))
      .orderBy(desc(carts.lastActivityAt))
      .limit(limit)
      .offset(offset)

    return ok({
      items: rows.map((c) => {
        const items = parseCartItems(c.items)
        const subtotal = Math.round(items.reduce((s, i) => s + Number(i.price) * Number(i.quantity), 0) * 100) / 100
        return {
          id: c.id,
          customerId: c.customerId,
          itemCount: items.length,
          quantity: items.reduce((s, i) => s + Number(i.quantity), 0),
          subtotal,
          items: items.slice(0, 10),
          status: c.status,
          abandonedAt: c.abandonedAt,
          recoverySentAt: c.recoverySentAt,
          recoveredOrderId: c.recoveredOrderId,
          lastActivityAt: c.lastActivityAt,
          createdAt: c.createdAt
        }
      }),
      page,
      limit
    })
  }

  private static async sendRecoveryEmail(
    db: DB,
    merchantId: string,
    to: string,
    recoveryCode: string,
    cartItems: unknown = [],
    incentive?: { incentiveCode: string; subtotal: number }
  ) {
    try {
      const [merchant] = await db
        .select({ name: merchants.name })
        .from(merchants)
        .where(eq(merchants.id, merchantId))
      const [settings] = await db
        .select({ name: storeSettings.name })
        .from(storeSettings)
        .where(eq(storeSettings.merchantId, merchantId))
      const storeName = settings?.name ?? merchant?.name ?? 'Our store'
      const fromEmail = process.env.MAIL_FROM_FALLBACK ?? 'onboarding@resend.dev'

      const recoveryUrl = `${process.env.PUBLIC_STOREFRONT_URL ?? 'http://localhost:5479'}/checkout?recovery=${encodeURIComponent(recoveryCode)}`

      const parsed = parseCartItems(cartItems)
      const itemLines = parsed.length > 0 ? parsed.map((i) => ({
        name: i.name,
        quantity: Number(i.quantity),
        total: `${Number(i.price) * Number(i.quantity)}`
      })) : undefined
      const isSecondTouch = !!incentive
      const html = renderEmail({
        title: isSecondTouch ? 'Still thinking it over? Take 10% off' : 'Complete your purchase',
        intro: isSecondTouch
          ? `Your cart is still waiting — use code ${incentive?.incentiveCode} for 10% off (single use, 7 days).`
          : "You left some items in your cart — they're still waiting for you!",
        storeName,
        items: itemLines,
        ...(incentive ? { lines: [{ label: 'Coupon', value: incentive.incentiveCode }] } : {}),
        cta: { label: 'Complete your order', url: recoveryUrl },
        footerNote: 'No longer want cart reminders? Manage marketing emails in your account settings.'
      })

      await getMailer().send({
        from: `${storeName} <${fromEmail}>`,
        to,
        subject: isSecondTouch ? `10% off your ${storeName} cart` : `Complete your ${storeName} order`,
        html
      })
    } catch (e) {
      log.error('recovery email failed', e)
    }
  }
}
const generateRecoveryCode = () => {
  const buf = new Uint8Array(16)
  crypto.getRandomValues(buf)
  return Array.from(buf)
    .map((b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 24)
}

/** Deterministic per-cart second-touch incentive code (no schema change needed). */
const secondTouchCode = (cartId: string) =>
  `RC-${cartId.replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase().padStart(8, 'X')}`

const parseCartItems = (items: unknown): CartItem[] => {
  if (!Array.isArray(items)) return []
  return (items as CartItem[]).filter((i) => i && typeof i.name === 'string')
}
