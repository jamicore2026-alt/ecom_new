import { and, asc, count, desc, eq, gt, inArray, isNull } from 'drizzle-orm'
import { compare, hash } from 'bcryptjs'
import { db } from '../../database/client'
import {
  customerAddresses,
  customers,
  emailLogs,
  merchants,
  notificationSettings,
  orderItems,
  orders,
  passwordResetTokens,
  productImages,
  productVariants,
  products,
  reviews,
  verificationTokens,
  wishlistItems
} from '../../database/schema'
import { ok } from '../../shared/response'
import { badRequest, conflict, notFound, unauthorized } from '../../shared/errors'
import { makeMeta, parsePagination } from '../../shared/pagination'
import { getMailer, renderEmail } from '../../shared/mailer'

const number = (v: unknown) => Number(v)

const normalizeEmail = (email: string) => email.trim().toLowerCase()

/** CSPRNG token — url-safe base64. */
const cryptoRandomBase64Url = (bytes = 32) => {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Buffer.from(buf).toString('base64url')
}

/** Same cost as staff logins — keeps unknown-email responses indistinguishable. */
export const DUMMY_SHOPPER_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO7ZBpQ0F1ZqP1rOoO8u5fKk9Wl0eQeXy'

export interface ShopperContext {
  customer: typeof customers.$inferSelect
  merchant: typeof merchants.$inferSelect
}

const publicCustomer = (c: typeof customers.$inferSelect) => ({
  id: c.id,
  merchantId: c.merchantId,
  email: c.email,
  firstName: c.firstName,
  lastName: c.lastName,
  phone: c.phone,
  ordersCount: c.ordersCount,
  totalSpent: number(c.totalSpent),
  createdAt: c.createdAt
})

export class CustomerAuthService {
  /** Resolve the active store behind a slug and assert the shopper belongs to it. */
  static async requireShopper(slug: string, shopper: ShopperContext): Promise<ShopperContext> {
    const [merchant] = await db
      .select()
      .from(merchants)
      .where(and(eq(merchants.slug, slug), eq(merchants.status, 'active')))
    if (!merchant) throw notFound('STORE_NOT_FOUND', 'Store not found')
    if (shopper.customer.merchantId !== merchant.id) {
      throw unauthorized('Session does not belong to this store')
    }
    return { customer: shopper.customer, merchant }
  }

  static async register(
    slug: string,
    body: {
      email: string
      password: string
      firstName?: string
      lastName?: string
      orderNumber?: string
    }
  ) {
    const store = await this.resolveStore(slug)
    const email = normalizeEmail(body.email)
    const passwordHash = await hash(body.password, 12)

    const [existing] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.merchantId, store.merchant.id), eq(customers.email, email)))

    if (existing?.passwordHash) {
      throw conflict('EMAIL_IN_USE', 'An account with this email already exists')
    }

    let customer: typeof customers.$inferSelect
    if (existing) {
      // Claiming a guest account requires proof the requester controls the
      // mailbox — they must cite an order number from that guest history.
      if (!body.orderNumber?.trim()) {
        throw badRequest(
          'CLAIM_ORDER_REQUIRED',
          'This email has guest orders — provide a recent order number to set a password'
        )
      }
      const [proof] = await db
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.merchantId, store.merchant.id),
            eq(orders.customerId, existing.id),
            // Stored with a leading '#'; accept input either way.
            eq(
              orders.orderNumber,
              (() => {
                const n = body.orderNumber!.trim().toUpperCase()
                return n.startsWith('#') ? n : `#${n}`
              })()
            )
          )
        )
      if (!proof) {
        throw badRequest('CLAIM_ORDER_MISMATCH', 'Order number does not match this account')
      }

      ;[customer] = await db
        .update(customers)
        .set({
          passwordHash,
          firstName: body.firstName ?? existing.firstName,
          lastName: body.lastName ?? existing.lastName,
          phone: existing.phone,
          tokenVersion: existing.tokenVersion + 1
        })
        .where(eq(customers.id, existing.id))
        .returning()
    } else {
      ;[customer] = await db
        .insert(customers)
        .values({
          merchantId: store.merchant.id,
          email,
          passwordHash,
          firstName: body.firstName || null,
          lastName: body.lastName || null
        })
        .returning()
    }

    return ok({
      tokenPayload: {
        sub: customer.id,
        mid: store.merchant.id,
        tv: customer.tokenVersion
      },
      customer: publicCustomer(customer)
    })
  }

  static async login(slug: string, body: { email: string; password: string }) {
    const store = await this.resolveStore(slug)
    const email = normalizeEmail(body.email)

    const [customer] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.merchantId, store.merchant.id), eq(customers.email, email)))

    if (!customer?.passwordHash) {
      // Burn comparable time so account existence isn't measurable via latency.
      await compare(body.password, DUMMY_SHOPPER_HASH)
      throw unauthorized('Invalid email or password')
    }
    const valid = await compare(body.password, customer.passwordHash)
    if (!valid) throw unauthorized('Invalid email or password')

    return ok({
      tokenPayload: {
        sub: customer.id,
        mid: store.merchant.id,
        tv: customer.tokenVersion
      },
      customer: publicCustomer(customer)
    })
  }

  /** Rotate credentials and invalidate every issued shopper token. */
  static async changePassword(slug: string, shopper: ShopperContext, body: { currentPassword: string; newPassword: string }) {
    const { customer } = await this.requireShopper(slug, shopper)

    const valid = await compare(body.currentPassword, customer.passwordHash as string)
    if (!valid) throw unauthorized('Current password is incorrect')

    const [updated] = await db
      .update(customers)
      .set({
        passwordHash: await hash(body.newPassword, 12),
        tokenVersion: customer.tokenVersion + 1
      })
      .where(eq(customers.id, customer.id))
      .returning()

    return ok({
      tokenPayload: {
        sub: updated.id,
        mid: updated.merchantId,
        tv: updated.tokenVersion
      },
      customer: publicCustomer(updated)
    })
  }

  static async profile(slug: string, shopper: ShopperContext) {
    const { customer } = await this.requireShopper(slug, shopper)
    return ok(publicCustomer(customer))
  }

  /** Create or update the shopper's review for a product. Re-submissions go back to pending. */
  static async submitReview(
    slug: string,
    shopper: ShopperContext,
    body: { productId: string; rating: number; title?: string; body?: string }
  ) {
    const { customer, merchant } = await this.requireShopper(slug, shopper)

    const [product] = await db
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          eq(products.id, body.productId),
          eq(products.merchantId, merchant.id),
          eq(products.status, 'active')
        )
      )
    if (!product) throw notFound('PRODUCT_NOT_FOUND', 'Product not found')

    const authorName =
      [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim() ||
      customer.email.split('@')[0]

    const values = {
      rating: body.rating,
      title: body.title?.trim() || null,
      body: body.body?.trim() || null
    }

    const [existing] = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.productId, product.id), eq(reviews.customerId, customer.id)))

    let row: typeof reviews.$inferSelect
    if (existing) {
      ;[row] = await db
        .update(reviews)
        .set({ ...values, authorName, status: 'pending' })
        .where(eq(reviews.id, existing.id))
        .returning()
    } else {
      ;[row] = await db
        .insert(reviews)
        .values({
          merchantId: merchant.id,
          productId: product.id,
          customerId: customer.id,
          authorName,
          status: 'pending',
          ...values
        })
        .returning()
    }

    return ok({
      id: row.id,
      productId: row.productId,
      rating: row.rating,
      title: row.title,
      body: row.body,
      status: row.status,
      createdAt: row.createdAt
    })
  }

  /** The shopper's saved products, newest first. Archived products drop out silently. */
  static async wishlist(slug: string, shopper: ShopperContext) {
    const { customer, merchant } = await this.requireShopper(slug, shopper)

    const rows = await db
      .select({ productId: wishlistItems.productId, savedAt: wishlistItems.createdAt })
      .from(wishlistItems)
      .where(and(eq(wishlistItems.customerId, customer.id), eq(wishlistItems.merchantId, merchant.id)))
      .orderBy(desc(wishlistItems.createdAt))
    if (rows.length === 0) return ok({ items: [] })

    const ids = rows.map((r) => r.productId)
    const productRows = await db
      .select()
      .from(products)
      .where(and(inArray(products.id, ids), eq(products.merchantId, merchant.id), eq(products.status, 'active')))

    const variants = await db
      .select()
      .from(productVariants)
      .where(inArray(productVariants.productId, ids))
      .orderBy(asc(productVariants.createdAt))
    const variantsByProduct = new Map<string, typeof variants>()
    for (const v of variants) {
      variantsByProduct.set(v.productId, [...(variantsByProduct.get(v.productId) ?? []), v])
    }

    const imageRows = await db
      .select({ productId: productImages.productId, url: productImages.url })
      .from(productImages)
      .where(inArray(productImages.productId, ids))
      .orderBy(asc(productImages.sortOrder), asc(productImages.createdAt))
    const imageByProduct = new Map<string, string>()
    for (const img of imageRows) {
      if (!imageByProduct.has(img.productId)) imageByProduct.set(img.productId, img.url)
    }
    const productById = new Map(productRows.map((p) => [p.id, p]))

    const items = rows
      .filter((r) => productById.has(r.productId))
      .map((r) => {
        const p = productById.get(r.productId)!
        const vs = variantsByProduct.get(p.id) ?? []
        return {
          productId: p.id,
          name: p.name,
          slug: p.slug,
          price: Number(p.price),
          compareAtPrice: p.compareAtPrice === null ? null : Number(p.compareAtPrice),
          image: vs.find((v) => v.image)?.image ?? imageByProduct.get(p.id) ?? null,
          stock: vs.reduce((sum, v) => sum + v.inventory, 0),
          variantId: vs[0]?.id ?? p.id,
          optionCount: vs.length,
          savedAt: r.savedAt
        }
      })

    return ok({ items })
  }

  static async addWishlist(slug: string, shopper: ShopperContext, productId: string) {
    const { customer, merchant } = await this.requireShopper(slug, shopper)

    const [product] = await db
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          eq(products.id, productId),
          eq(products.merchantId, merchant.id),
          eq(products.status, 'active')
        )
      )
    if (!product) throw notFound('PRODUCT_NOT_FOUND', 'Product not found')

    await db
      .insert(wishlistItems)
      .values({ merchantId: merchant.id, customerId: customer.id, productId })
      .onConflictDoNothing()

    return ok({ saved: true, productId })
  }

  static async removeWishlist(slug: string, shopper: ShopperContext, productId: string) {
    const { customer, merchant } = await this.requireShopper(slug, shopper)

    const deleted = await db
      .delete(wishlistItems)
      .where(
        and(
          eq(wishlistItems.customerId, customer.id),
          eq(wishlistItems.merchantId, merchant.id),
          eq(wishlistItems.productId, productId)
        )
      )
      .returning({ id: wishlistItems.id })

    return ok({ removed: deleted.length > 0, productId })
  }

  static async ordersList(
    slug: string,
    shopper: ShopperContext,
    query: { page?: string; limit?: string }
  ) {
    const { customer, merchant } = await this.requireShopper(slug, shopper)
    const { page, limit, offset } = parsePagination(query)

    const [{ value: total }] = await db
      .select({ value: count() })
      .from(orders)
      .where(and(eq(orders.merchantId, merchant.id), eq(orders.customerId, customer.id)))

    const rows = await db
      .select()
      .from(orders)
      .where(and(eq(orders.merchantId, merchant.id), eq(orders.customerId, customer.id)))
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset)

    const itemRows = rows.length
      ? await db
          .select()
          .from(orderItems)
          .where(
            inArray(
              orderItems.orderId,
              rows.map((o) => o.id)
            )
          )
      : []

    return ok({
      items: rows.map((order) => {
        const lineItems = itemRows.filter((i) => i.orderId === order.id)
        return {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          paymentStatus: order.paymentStatus,
          paymentMethod: order.paymentMethod,
          subtotal: number(order.subtotal),
          shippingTotal: number(order.shippingTotal),
          discountTotal: number(order.discountTotal),
          taxTotal: number(order.taxTotal),
          total: number(order.total),
          currency: order.currency,
          createdAt: order.createdAt,
          itemCount: lineItems.reduce((n, i) => n + i.quantity, 0),
          items: lineItems.map((i) => ({
            name: i.name,
            sku: i.sku,
            price: number(i.price),
            quantity: i.quantity,
            total: number(i.total)
          }))
        }
      }),
      meta: makeMeta(page, limit, Number(total))
    })
  }


  /* ------------------------------ password reset ------------------------------ */

  /** Request a password reset — always succeeds (no account enumeration). */
  static async requestPasswordReset(slug: string, email: string) {
    const store = await this.resolveStore(slug)
    const normalized = normalizeEmail(email)

    const [customer] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.merchantId, store.merchant.id), eq(customers.email, normalized)))

    // No account → success anyway (no enumeration), nothing queued.
    if (!customer?.passwordHash) return ok({ status: 'sent' })

    return this.issueResetToken(store.merchant.id, customer)
  }

  private static async issueResetToken(merchantId: string, customer: typeof customers.$inferSelect) {
    const raw = cryptoRandomBase64Url(32)
    const tokenHash = await hash(raw, 10)
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    // Invalidate prior outstanding reset tokens for this customer.
    await db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordResetTokens.merchantId, merchantId),
          eq(passwordResetTokens.customerId, customer.id),
          isNull(passwordResetTokens.usedAt)
        )
      )

    await db.insert(passwordResetTokens).values({
      merchantId,
      customerId: customer.id,
      tokenHash,
      expiresAt
    })

    await this.sendPasswordResetEmail(merchantId, customer, raw)
    return ok({ status: 'sent' })
  }

  /** Complete a password reset — validated + single-use + invalidates sessions. */
  static async resetPassword(slug: string, token: string, newPassword: string) {
    // The stored hash uses compare() (bcrypt), so find candidate tokens by customer
    // and compare — bcrypt can't be used in an equality query.
    const [merchant] = await db
      .select({ id: merchants.id })
      .from(merchants)
      .where(eq(merchants.slug, slug))
    if (!merchant) throw notFound('STORE_NOT_FOUND', 'Store not found')

    const pendingTokens = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.merchantId, merchant.id),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, new Date())
        )
      )

    for (const tr of pendingTokens) {
      if (await compare(token, tr.tokenHash)) {
        const [customer] = await db
          .select()
          .from(customers)
          .where(and(eq(customers.id, tr.customerId), eq(customers.merchantId, merchant.id)))
        if (!customer) throw notFound('CUSTOMER_NOT_FOUND', 'Customer not found')

        // Single use — mark consumed BEFORE hashing the new password.
        await db
          .update(passwordResetTokens)
          .set({ usedAt: new Date() })
          .where(eq(passwordResetTokens.id, tr.id))

        // Invalidate all outstanding reset tokens + verify tokens for this customer.
        await db
          .update(passwordResetTokens)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(passwordResetTokens.customerId, customer.id),
              eq(passwordResetTokens.merchantId, merchant.id),
              isNull(passwordResetTokens.usedAt)
            )
          )

        // Bump tokenVersion — this kills every previously-issued shopper JWT.
        const [updated] = await db
          .update(customers)
          .set({
            passwordHash: await hash(newPassword, 12),
            tokenVersion: customer.tokenVersion + 1
          })
          .where(eq(customers.id, customer.id))
          .returning()

        return ok({
          customer: publicCustomer(updated),
          logout: true
        })
      }
    }

    throw badRequest('INVALID_RESET_TOKEN', 'Reset token is invalid or has expired')
  }

  /* ---------------------------- email verification ---------------------------- */

  /** Send (or re-send) a verification email to the shopper. Idempotent-ish, rate-limited upstream. */
  static async requestEmailVerification(slug: string, shopper: ShopperContext) {
    const { customer, merchant } = await this.requireShopper(slug, shopper)
    if (customer.emailVerified) {
      return ok({ verified: true, message: 'Email is already verified' })
    }

    const raw = cryptoRandomBase64Url(32)
    const tokenHash = await hash(raw, 10)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h

    await db.insert(verificationTokens).values({
      merchantId: merchant.id,
      customerId: customer.id,
      tokenHash,
      type: 'email_verification',
      expiresAt
    })

    await this.sendVerificationEmail(merchant.id, customer, merchant.slug as string, raw)
    return ok({ verifies: true, message: 'Verification email sent' })
  }

  /** Verify an email token — single-use, hashed, expiring. */
  static async verifyEmail(slug: string, token: string) {
    const [merchant] = await db
      .select()
      .from(merchants)
      .where(and(eq(merchants.slug, slug), eq(merchants.status, 'active')))
    if (!merchant) throw notFound('STORE_NOT_FOUND', 'Store not found')

    const pendingTokens = await db
      .select()
      .from(verificationTokens)
      .where(
        and(
          eq(verificationTokens.merchantId, merchant.id),
          eq(verificationTokens.type, 'email_verification'),
          isNull(verificationTokens.usedAt),
          gt(verificationTokens.expiresAt, new Date())
        )
      )

    for (const tr of pendingTokens) {
      if (await compare(token, tr.tokenHash)) {
        const [customer] = await db
          .select()
          .from(customers)
          .where(and(eq(customers.id, tr.customerId), eq(customers.merchantId, merchant.id)))
        if (!customer) throw notFound('CUSTOMER_NOT_FOUND', 'Customer not found')

        await db
          .update(verificationTokens)
          .set({ usedAt: new Date() })
          .where(eq(verificationTokens.id, tr.id))

        const [verified] = await db
          .update(customers)
          .set({ emailVerified: true, emailVerifiedAt: new Date() })
          .where(eq(customers.id, customer.id))
          .returning()

        return ok({ verified: true, customer: publicCustomer(verified) })
      }
    }

    throw badRequest('INVALID_VERIFICATION_TOKEN', 'Verification token is invalid or has expired')
  }

  /* ------------------------------ address book ------------------------------ */

  static async listAddresses(slug: string, shopper: ShopperContext) {
    const { customer, merchant } = await this.requireShopper(slug, shopper)
    const rows = await db
      .select()
      .from(customerAddresses)
      .where(and(eq(customerAddresses.customerId, customer.id), eq(customerAddresses.merchantId, merchant.id)))
      .orderBy(desc(customerAddresses.isDefaultShipping), asc(customerAddresses.createdAt))
    return ok({ items: rows })
  }

  static async createAddress(
    slug: string,
    shopper: ShopperContext,
    body: {
      label?: string
      addressType?: 'shipping' | 'billing' | 'both'
      name?: string
      company?: string
      line1: string
      line2?: string
      city?: string
      state?: string
      postalCode?: string
      country: string
      phone?: string
    }
  ) {
    const { customer, merchant } = await this.requireShopper(slug, shopper)

    const [address] = await db
      .insert(customerAddresses)
      .values({
        merchantId: merchant.id,
        customerId: customer.id,
        label: body.label?.trim() || 'default',
        addressType: body.addressType ?? 'both',
        name: body.name ?? customer.firstName,
        company: body.company,
        line1: body.line1,
        line2: body.line2,
        city: body.city,
        state: body.state,
        postalCode: body.postalCode,
        country: body.country,
        phone: body.phone,
        isDefaultShipping: false,
        isDefaultBilling: false
      })
      .returning()

    // First address becomes the default shipping/billing destination.
    const [{ value: addressCount }] = await db
      .select({ value: count() })
      .from(customerAddresses)
      .where(eq(customerAddresses.customerId, customer.id))
    if (Number(addressCount) === 1) {
      await db
        .update(customerAddresses)
        .set({ isDefaultShipping: true, isDefaultBilling: true })
        .where(eq(customerAddresses.id, address.id))
      address.isDefaultShipping = true
      address.isDefaultBilling = true
    }

    return ok({ data: address })
  }

  static async updateAddress(
    slug: string,
    shopper: ShopperContext,
    id: string,
    body: {
      label?: string
      addressType?: 'shipping' | 'billing' | 'both'
      name?: string
      company?: string
      line1?: string
      line2?: string
      city?: string
      state?: string
      postalCode?: string
      country?: string
      phone?: string
    }
  ) {
    const { customer, merchant } = await this.requireShopper(slug, shopper)
    await this.assertAddressOwned(customer.id, merchant.id, id)

    const [updated] = await db
      .update(customerAddresses)
      .set({
        ...(body.label !== undefined && { label: body.label }),
        ...(body.addressType !== undefined && { addressType: body.addressType }),
        ...(body.name !== undefined && { name: body.name }),
        ...(body.company !== undefined && { company: body.company }),
        ...(body.line1 !== undefined && { line1: body.line1 }),
        ...(body.line2 !== undefined && { line2: body.line2 }),
        ...(body.city !== undefined && { city: body.city }),
        ...(body.state !== undefined && { state: body.state }),
        ...(body.postalCode !== undefined && { postalCode: body.postalCode }),
        ...(body.country !== undefined && { country: body.country }),
        ...(body.phone !== undefined && { phone: body.phone }),
        updatedAt: new Date()
      })
      .where(and(eq(customerAddresses.id, id), eq(customerAddresses.customerId, customer.id)))
      .returning()

    return ok({ data: updated })
  }

  static async deleteAddress(slug: string, shopper: ShopperContext, id: string) {
    const { customer, merchant } = await this.requireShopper(slug, shopper)
    const row = await this.assertAddressOwned(customer.id, merchant.id, id)

    await db
      .delete(customerAddresses)
      .where(and(eq(customerAddresses.id, id), eq(customerAddresses.customerId, customer.id)))

    // If we deleted the default shipping/billing, promote another address if any remain.
    if (row.isDefaultShipping || row.isDefaultBilling) {
      const remaining = await db
        .select()
        .from(customerAddresses)
        .where(eq(customerAddresses.customerId, customer.id))
        .orderBy(asc(customerAddresses.createdAt))
        .limit(1)
      if (remaining.length > 0) {
        await db
          .update(customerAddresses)
          .set({
            ...(row.isDefaultShipping && { isDefaultShipping: true }),
            ...(row.isDefaultBilling && { isDefaultBilling: true })
          })
          .where(eq(customerAddresses.id, remaining[0].id))
      }
    }

    return ok({ deleted: true, id })
  }

  static async setDefaultAddress(
    slug: string,
    shopper: ShopperContext,
    id: string,
    type: 'shipping' | 'billing'
  ) {
    const { customer, merchant } = await this.requireShopper(slug, shopper)
    await this.assertAddressOwned(customer.id, merchant.id, id)

    // Clear any existing default of that type.
    await db
      .update(customerAddresses)
      .set({ ...(type === 'shipping' ? { isDefaultShipping: false } : { isDefaultBilling: false }) })
      .where(eq(customerAddresses.customerId, customer.id))

    await db
      .update(customerAddresses)
      .set({ ...(type === 'shipping' ? { isDefaultShipping: true } : { isDefaultBilling: true }) })
      .where(and(eq(customerAddresses.id, id), eq(customerAddresses.customerId, customer.id)))

    return ok({ updated: true, id, type })
  }

  private static async assertAddressOwned(customerId: string, merchantId: string, id: string) {
    const [row] = await db
      .select()
      .from(customerAddresses)
      .where(
        and(
          eq(customerAddresses.id, id),
          eq(customerAddresses.customerId, customerId),
          eq(customerAddresses.merchantId, merchantId)
        )
      )
    if (!row) throw notFound('ADDRESS_NOT_FOUND', 'Address not found')
    return row
  }

  /* ------------------------------- email helpers ------------------------------ */

  private static async sendPasswordResetEmail(
    merchantId: string,
    customer: typeof customers.$inferSelect,
    token: string
  ) {
    // Fire-and-forget — never blocks the request path.
    void this.sendTransactional({
      merchantId,
      to: customer.email,
      subject: 'Reset your password',
      token,
      template: 'reset_password'
    }).catch(() => undefined)
  }

  private static async sendVerificationEmail(
    merchantId: string,
    customer: typeof customers.$inferSelect,
    slug: string,
    token: string
  ) {
    void this.sendTransactional({
      merchantId,
      to: customer.email,
      subject: 'Verify your email address',
      token,
      template: 'email_verification',
      slug
    }).catch(() => undefined)
  }

  private static async sendTransactional(input: {
    merchantId: string
    to: string
    subject: string
    token: string
    template: string
    slug?: string
  }): Promise<void> {
    try {
      const [settingsRow] = await db
        .select({ enabled: notificationSettings.enabled })
        .from(notificationSettings)
        .where(eq(notificationSettings.merchantId, input.merchantId))
      // If no notification settings row exists, notifications default to enabled.
      if (settingsRow && !settingsRow.enabled) return

      const [merchant] = await db
        .select({ name: merchants.name })
        .from(merchants)
        .where(eq(merchants.id, input.merchantId))

      const storeName = merchant?.name ?? 'Our store'
      const fromEmail = process.env.MAIL_FROM_FALLBACK ?? 'onboarding@resend.dev'

      const title = input.template === 'reset_password' ? 'Reset your password' : 'Verify your email'
      const url = input.slug
        ? `${process.env.PUBLIC_STOREFRONT_URL ?? 'http://localhost:5479'}/${input.slug}/account?verify=${encodeURIComponent(input.token)}`
        : `${process.env.PUBLIC_STOREFRONT_URL ?? 'http://localhost:5479'}/account?reset=${encodeURIComponent(input.token)}`

      const html = renderEmail({
        title,
        intro:
          input.template === 'reset_password'
            ? 'We received a request to reset your password. Click below to set a new one. If you did not request this, you can safely ignore this email.'
            : 'Confirm that this is your email address to keep your account secure.',
        storeName,
        cta: { label: input.template === 'reset_password' ? 'Reset password' : 'Verify email', url }
      })

      await db.insert(emailLogs).values({
        merchantId: input.merchantId,
        toEmail: input.to,
        template: input.template as never,
        subject: input.subject,
        status: 'queued'
      })

      const result = await getMailer().send({
        from: `${storeName} <${fromEmail}>`,
        to: input.to,
        subject: input.subject,
        html
      })

      // Update the last email log we just inserted to reflect delivery status.
      const [log] = await db
        .select({ id: emailLogs.id })
        .from(emailLogs)
        .where(eq(emailLogs.toEmail, input.to))
        .orderBy(desc(emailLogs.createdAt))
        .limit(1)
      if (log) {
        await db
          .update(emailLogs)
          .set(
            result.ok && result.id === 'noop'
              ? { status: 'skipped', providerRef: 'noop' }
              : result.ok
                ? { status: 'sent', providerRef: result.id ?? null, sentAt: new Date() }
                : { status: 'failed', error: result.error ?? 'Unknown mailer error' }
          )
          .where(eq(emailLogs.id, log.id))
      }
    } catch (e) {
      console.error('[emails] sendTransactional failed:', e)
    }
  }


  private static async resolveStore(slug: string) {
    const [merchant] = await db
      .select({ id: merchants.id })
      .from(merchants)
      .where(and(eq(merchants.slug, slug), eq(merchants.status, 'active')))
    if (!merchant) throw notFound('STORE_NOT_FOUND', 'Store not found')
    return { merchant }
  }
}
