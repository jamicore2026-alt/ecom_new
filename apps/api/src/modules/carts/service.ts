import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm'
import { db } from '../../database/client'
import { carts, customers, merchants, storeSettings } from '../../database/schema'
import { ok } from '../../shared/response'
import { notFound } from '../../shared/errors'
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
    if (!existing && input.customerId) {
      const [byCustomer] = await db
        .select()
        .from(carts)
        .where(and(eq(carts.merchantId, merchant.id), eq(carts.customerId, input.customerId)))
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
          customerId: input.customerId ?? existing.customerId,
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
        customerId: input.customerId ?? null,
        items: input.items as never,
        status: 'active',
        lastActivityAt: new Date()
      })
      .returning()

    return ok({ cart })
  }

  /** Mark a cart as abandoned + trigger recovery email. Returns count touched. */
  static async sweepAbandonedCarts(abandonAfterMs: number = 24 * 60 * 60 * 1000): Promise<number> {
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

      // Look up customer for recovery email
      let email: string | null = null
      if (cart.customerId) {
        const [customer] = await db
          .select({ email: customers.email })
          .from(customers)
          .where(eq(customers.id, cart.customerId))
        email = customer?.email ?? null
      }

      if (!email) continue

      await db
        .update(carts)
        .set({ recoveryCode: generateRecoveryCode(), recoverySentAt: new Date() })
        .where(eq(carts.id, cart.id))

      const [updated] = await db
        .select()
        .from(carts)
        .where(eq(carts.id, cart.id))

      await this.sendRecoveryEmail(cart.merchantId, email, updated.recoveryCode as string)
      count++
    }

    return count
  }

  /** Recover a cart from a recovery code — restore the items (client revalidates stock). */
  static async recoverCart(slug: string, recoveryCode: string, customerId?: string) {
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
  static async list(merchantId: string, query: { status?: string; page?: string; limit?: string } = {}) {
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
      items: rows.map((c) => ({
        id: c.id,
        customerId: c.customerId,
        itemCount: Array.isArray(c.items) ? (c.items as CartItem[]).length : 0,
        status: c.status,
        abandonedAt: c.abandonedAt,
        lastActivityAt: c.lastActivityAt,
        createdAt: c.createdAt
      })),
      page,
      limit
    })
  }

  private static async sendRecoveryEmail(merchantId: string, to: string, recoveryCode: string) {
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

      const html = renderEmail({
        title: 'Complete your purchase',
        intro: "You left some items in your cart — they're still waiting for you!",
        storeName,
        cta: { label: 'Complete your order', url: recoveryUrl }
      })

      await getMailer().send({
        from: `${storeName} <${fromEmail}>`,
        to,
        subject: `Complete your ${storeName} order`,
        html
      })
    } catch (e) {
      console.error('[carts] recovery email failed:', e)
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
