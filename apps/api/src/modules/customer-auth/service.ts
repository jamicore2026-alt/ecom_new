import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'
import { compare, hash } from 'bcryptjs'
import { db } from '../../database/client'
import {
  customers,
  merchants,
  orderItems,
  orders,
  productImages,
  productVariants,
  products,
  reviews,
  wishlistItems
} from '../../database/schema'
import { ok } from '../../shared/response'
import { conflict, notFound, unauthorized } from '../../shared/errors'
import { makeMeta, parsePagination } from '../../shared/pagination'

const number = (v: unknown) => Number(v)

const normalizeEmail = (email: string) => email.trim().toLowerCase()

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
    body: { email: string; password: string; firstName?: string; lastName?: string }
  ) {
    const store = await this.resolveStore(slug)
    const email = normalizeEmail(body.email)
    const passwordHash = await hash(body.password, 10)

    const [existing] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.merchantId, store.merchant.id), eq(customers.email, email)))

    if (existing?.passwordHash) {
      throw conflict('EMAIL_IN_USE', 'An account with this email already exists')
    }

    let customer: typeof customers.$inferSelect
    if (existing) {
      // Guest customer upgrading to an account — attach credentials.
      ;[customer] = await db
        .update(customers)
        .set({
          passwordHash,
          firstName: body.firstName ?? existing.firstName,
          lastName: body.lastName ?? existing.lastName,
          phone: existing.phone
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

    return ok({ tokenPayload: { sub: customer.id, mid: store.merchant.id }, customer: publicCustomer(customer) })
  }

  static async login(slug: string, body: { email: string; password: string }) {
    const store = await this.resolveStore(slug)
    const email = normalizeEmail(body.email)

    const [customer] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.merchantId, store.merchant.id), eq(customers.email, email)))

    if (!customer?.passwordHash) throw unauthorized('Invalid email or password')
    const valid = await compare(body.password, customer.passwordHash)
    if (!valid) throw unauthorized('Invalid email or password')

    return ok({ tokenPayload: { sub: customer.id, mid: store.merchant.id }, customer: publicCustomer(customer) })
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

  private static async resolveStore(slug: string) {
    const [merchant] = await db
      .select({ id: merchants.id })
      .from(merchants)
      .where(and(eq(merchants.slug, slug), eq(merchants.status, 'active')))
    if (!merchant) throw notFound('STORE_NOT_FOUND', 'Store not found')
    return { merchant }
  }
}
