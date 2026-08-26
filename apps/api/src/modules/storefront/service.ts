import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db } from '../../database/client'
import {
  categories,
  coupons,
  customers,
  inventoryLogs,
  merchants,
  orderItems,
  orders,
  paymentProviderConfigs,
  paymentSettings,
  paymentTransactions,
  productImages,
  products,
  productVariants,
  reviews,
  shippingSettings,
  storeSettings,
  taxSettings,
  visits
} from '../../database/schema'
import { DiscountsService } from '../discounts/service'
import { EmailsService } from '../emails/service'
import { makeMeta, parsePagination } from '../../shared/pagination'
import { markOrderPaidEffects } from '../../shared/order-payments'
import { runCancelPendingOrder } from '../../shared/order-cancel'
import { roundForCurrency } from '../../shared/currency'
import { productSearchCondition, productSearchRank } from '../../shared/product-search'
import { getProvider, listProviders } from '../../payments/registry'
import { ok } from '../../shared/response'
import { badRequest, notFound } from '../../shared/errors'
import type { CallbackResult } from '../../payments/types'

const number = (v: unknown) => Number(v)

export interface CheckoutItemInput {
  productId: string
  variantId: string
  quantity: number
}

export interface CheckoutInput extends CheckoutPreviewInput {
  email: string
  shippingAddress: Record<string, unknown>
  billingAddress?: Record<string, unknown>
  paymentMethod: string
  notes?: string
}

export interface CheckoutPreviewInput {
  items: CheckoutItemInput[]
  couponCode?: string
  /** Optional country so previewed totals match the final order's shipping/tax. */
  shippingAddress?: { country?: string }
}

interface StorePayload {
  merchant: { id: string; name: string; slug: string; currency: string; timezone: string }
  settings: {
    name: string
    logo: string | null
    announcement: string
    address: object
    currency: string
    timezone: string
  }
  payments: {
    methods: Array<{ id: string; label: string; enabled: boolean }>
    currency: string
    providers?: Array<{ id: string; label: string }>
  }
  shipping: {
    zones: Array<{ name: string; countries: string[]; rate: number; freeAbove?: number }>
    freeShippingThreshold: number
  }
  taxes: {
    autoCalculate: boolean
    rates: Array<{ region: string; rate: number }>
  }
}

interface CheckoutLine {
  productId: string
  variantId: string
  name: string
  sku: string | null
  price: number
  image: string | null
  optionValues: Record<string, string>
  trackInventory: boolean
  quantity: number
  total: number
}

export interface StorefrontQuery {
  page?: string
  limit?: string
  search?: string
  category?: string
  categoryId?: string
  minPrice?: string
  maxPrice?: string
  sort?: string
}

interface PublicCategory {
  id: string
  name: string
  slug: string
  image: string | null
}

interface PublicProduct {
  id: string
  merchantId: string
  name: string
  slug: string
  description: string
  price: number
  compareAtPrice: number | null
  sku: string | null
  trackInventory: boolean
  lowStockThreshold: number
  status: string
  createdAt: Date
  updatedAt: Date
  stock: number
  variantCount: number
  image: string | null
  category: PublicCategory | null
}

export class StorefrontService {
  /* ------------------------------- store info ------------------------------ */

  static async resolveStore(slug: string) {
    const [merchant] = await db
      .select()
      .from(merchants)
      .where(and(eq(merchants.slug, slug), eq(merchants.status, 'active')))
    if (!merchant) throw notFound('STORE_NOT_FOUND', 'Store not found')

    const [settings] = await db
      .select()
      .from(storeSettings)
      .where(eq(storeSettings.merchantId, merchant.id))
    const [payments] = await db
      .select()
      .from(paymentSettings)
      .where(eq(paymentSettings.merchantId, merchant.id))
    const [shipping] = await db
      .select()
      .from(shippingSettings)
      .where(eq(shippingSettings.merchantId, merchant.id))
    const [taxes] = await db
      .select()
      .from(taxSettings)
      .where(eq(taxSettings.merchantId, merchant.id))

    const providerRows = await db
      .select()
      .from(paymentProviderConfigs)
      .where(and(eq(paymentProviderConfigs.merchantId, merchant.id), eq(paymentProviderConfigs.enabled, true)))
    const defs = new Map(listProviders().map((d) => [d.id, d]))
    const providers = providerRows
      .filter((p) => defs.has(p.provider))
      .map((p) => ({ id: p.provider, label: defs.get(p.provider)!.label }))

    return {
      merchant: {
        id: merchant.id,
        name: merchant.name,
        slug: merchant.slug,
        currency: merchant.currency,
        timezone: merchant.timezone
      },
      settings: {
        name: settings?.name ?? merchant.name,
        logo: settings?.logo ?? null,
        announcement: settings?.announcement ?? '',
        address: settings?.address ?? {},
        currency: settings?.currency ?? merchant.currency,
        timezone: settings?.timezone ?? merchant.timezone
      },
      payments: {
        methods: payments?.methods ?? [],
        currency: payments?.currency ?? merchant.currency,
        providers
      },
      shipping: {
        zones: shipping?.zones ?? [],
        freeShippingThreshold: number(shipping?.freeShippingThreshold ?? 0)
      },
      taxes: {
        autoCalculate: taxes?.autoCalculate ?? true,
        rates: taxes?.rates ?? []
      }
    }
  }

  static async store(slug: string) {
    return ok(await this.resolveStore(slug))
  }

  static async listStores() {
    const rows = await db
      .select({ slug: merchants.slug, name: merchants.name })
      .from(merchants)
      .where(eq(merchants.status, 'active'))
      .orderBy(asc(merchants.slug))
    return ok(rows)
  }

  /* --------------------------------- sitemap ------------------------------- */

  static async sitemap(slug: string) {
    const store = await this.resolveStore(slug)
    const productRows = await db
      .select({ slug: products.slug })
      .from(products)
      .where(and(eq(products.merchantId, store.merchant.id), eq(products.status, 'active')))
      .orderBy(asc(products.slug))
    const categoryRows = await db
      .select({ slug: categories.slug })
      .from(categories)
      .where(eq(categories.merchantId, store.merchant.id))
      .orderBy(asc(categories.slug))
    return ok({ categories: categoryRows, products: productRows })
  }

  /* ------------------------------ funnel events ---------------------------- */

  static async trackEvent(
    slug: string,
    body: { type: 'view' | 'cart_add' | 'checkout_start'; channel?: string }
  ) {
    const store = await this.resolveStore(slug)
    // Allowlist channels — arbitrary client strings would mint unbounded visits rows.
    const FUNNEL_CHANNELS = new Set(['direct', 'organic', 'social', 'paid', 'email', 'referral'])
    const channel = body.channel && FUNNEL_CHANNELS.has(body.channel) ? body.channel : 'direct'

    const now = new Date()
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    await db
      .insert(visits)
      .values({
        merchantId: store.merchant.id,
        date,
        channel,
        views: body.type === 'view' ? 1 : 0,
        cartAdds: body.type === 'cart_add' ? 1 : 0,
        checkouts: body.type === 'checkout_start' ? 1 : 0
      })
      .onConflictDoUpdate({
        target: [visits.merchantId, visits.date, visits.channel],
        set: {
          views: sql`${visits.views} + ${body.type === 'view' ? 1 : 0}`,
          cartAdds: sql`${visits.cartAdds} + ${body.type === 'cart_add' ? 1 : 0}`,
          checkouts: sql`${visits.checkouts} + ${body.type === 'checkout_start' ? 1 : 0}`
        }
      })

    return ok({ tracked: true })
  }

  /* -------------------------------- categories ----------------------------- */

  static async categories(slug: string) {
    const store = await this.resolveStore(slug)
    const rows = await db
      .select()
      .from(categories)
      .where(and(eq(categories.merchantId, store.merchant.id), eq(categories.status, 'active')))
      .orderBy(asc(categories.sortOrder), asc(categories.name))

    const productCounts = await db
      .select({ categoryId: products.categoryId, count: count() })
      .from(products)
      .where(and(eq(products.merchantId, store.merchant.id), eq(products.status, 'active')))
      .groupBy(products.categoryId)
    const countMap = new Map(productCounts.map((c) => [c.categoryId, Number(c.count)]))

    const children = new Map<string, typeof rows[number][]>()
    const roots: typeof rows = []
    for (const cat of rows) {
      if (cat.parentId) {
        children.set(cat.parentId, [...(children.get(cat.parentId) ?? []), cat])
      } else {
        roots.push(cat)
      }
    }

    const build = (cat: typeof rows[number], visited = new Set<string>()): unknown => {
      if (visited.has(cat.id)) return { ...cat, productCount: 0, children: [] }
      const next = new Set(visited).add(cat.id)
      return {
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        image: cat.image,
        sortOrder: cat.sortOrder,
        productCount: countMap.get(cat.id) ?? 0,
        children: (children.get(cat.id) ?? []).map((c) => build(c, next))
      }
    }
    return ok({ items: roots.map((r) => build(r)) })
  }

  /* -------------------------------- products ------------------------------- */

  private static async categoryAndDescendants(merchantId: string, categorySlug: string) {
    const [cat] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.merchantId, merchantId), eq(categories.slug, categorySlug)))
    if (!cat) throw notFound('CATEGORY_NOT_FOUND', 'Category not found')

    const rows = await db
      .select({ id: categories.id, parentId: categories.parentId })
      .from(categories)
      .where(eq(categories.merchantId, merchantId))
    const children = new Map<string, string[]>()
    for (const row of rows) {
      if (row.parentId) children.set(row.parentId, [...(children.get(row.parentId) ?? []), row.id])
    }
    const ids = [cat.id]
    const stack = [cat.id]
    while (stack.length) {
      for (const child of children.get(stack.pop()!) ?? []) {
        ids.push(child)
        stack.push(child)
      }
    }
    return ids
  }

  private static async enrich(
    merchantId: string,
    rows: typeof products.$inferSelect[]
  ): Promise<PublicProduct[]> {
    if (!rows.length) return []
    const ids = rows.map((r) => r.id)

    const variants = await db
      .select()
      .from(productVariants)
      .where(inArray(productVariants.productId, ids))
    const variantsByProduct = new Map<string, typeof variants>()
    for (const v of variants) {
      variantsByProduct.set(v.productId, [...(variantsByProduct.get(v.productId) ?? []), v])
    }

    const imageRows = await db
      .select()
      .from(productImages)
      .where(inArray(productImages.productId, ids))
      .orderBy(asc(productImages.sortOrder), asc(productImages.createdAt))
    const galleryByProduct = new Map<string, string[]>()
    for (const img of imageRows) {
      galleryByProduct.set(img.productId, [...(galleryByProduct.get(img.productId) ?? []), img.url])
    }

    const catIds = [
      ...new Set(rows.map((r) => r.categoryId).filter((v): v is string => !!v))
    ]
    const catMap = catIds.length
      ? new Map(
          (await db.select().from(categories).where(inArray(categories.id, catIds))).map((c) => [
            c.id,
            c
          ])
        )
      : new Map()

    return rows.map((p) => {
      const productVariants_ = variantsByProduct.get(p.id) ?? []
      const category = p.categoryId ? (catMap.get(p.categoryId) ?? null) : null
      const gallery = galleryByProduct.get(p.id) ?? []
      const image =
        productVariants_.find((v) => v.image)?.image ?? gallery[0] ?? category?.image ?? null
      return {
        id: p.id,
        merchantId,
        name: p.name,
        slug: p.slug,
        description: p.description,
        price: number(p.price),
        compareAtPrice: p.compareAtPrice === null ? null : number(p.compareAtPrice),
        sku: p.sku,
        trackInventory: p.trackInventory,
        lowStockThreshold: p.lowStockThreshold,
        status: p.status,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        stock: productVariants_.reduce((sum, v) => sum + v.inventory, 0),
        variantCount: productVariants_.length,
        image,
        category: category
          ? { id: category.id, name: category.name, slug: category.slug, image: category.image }
          : null
      } as PublicProduct
    })
  }

  static async products(slug: string, q: StorefrontQuery) {
    const store = await this.resolveStore(slug)
    const { page, limit, offset } = parsePagination(q)
    const conditions = [
      eq(products.merchantId, store.merchant.id),
      eq(products.status, 'active')
    ]

    const search = q.search?.trim()
    let relevance: SQL | undefined
    if (search) {
      const cond = productSearchCondition(search)
      if (cond) conditions.push(cond)
      relevance = productSearchRank(search)
    }

    if (q.categoryId) {
      conditions.push(eq(products.categoryId, q.categoryId))
    } else if (q.category) {
      const ids = await this.categoryAndDescendants(store.merchant.id, q.category)
      conditions.push(inArray(products.categoryId, ids))
    }

    if (q.minPrice !== undefined && q.minPrice !== '') {
      conditions.push(gte(products.price, Number(q.minPrice)))
    }
    if (q.maxPrice !== undefined && q.maxPrice !== '') {
      conditions.push(lte(products.price, Number(q.maxPrice)))
    }

    const where = and(...conditions)
    const [{ total }] = await db.select({ total: count() }).from(products).where(where)

    const orderBy =
      q.sort === 'price_asc'
        ? [asc(products.price)]
        : q.sort === 'price_desc'
          ? [desc(products.price)]
          : relevance
            ? [desc(relevance), desc(products.createdAt)]
            : [desc(products.createdAt)]
    const rows = await db
      .select()
      .from(products)
      .where(where)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset)

    return ok({
      items: await this.enrich(store.merchant.id, rows),
      meta: makeMeta(page, limit, Number(total))
    })
  }

  static async product(slug: string, productSlug: string) {
    const store = await this.resolveStore(slug)
    const [product] = await db
      .select()
      .from(products)
      .where(
        and(
          eq(products.merchantId, store.merchant.id),
          eq(products.status, 'active'),
          eq(products.slug, productSlug)
        )
      )
    if (!product) throw notFound('PRODUCT_NOT_FOUND', 'Product not found')

    const variants = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, product.id))

    const [category] = product.categoryId
      ? await db
          .select()
          .from(categories)
          .where(eq(categories.id, product.categoryId))
      : []

    const stock = variants.reduce((sum, v) => sum + v.inventory, 0)
    const galleryRows = await db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, product.id))
      .orderBy(asc(productImages.sortOrder), asc(productImages.createdAt))
    const gallery = galleryRows.map((g) => g.url)
    const image =
      variants.find((v) => v.image)?.image ?? gallery[0] ?? category?.image ?? null

    let relatedRows: typeof products.$inferSelect[] = []
    if (product.categoryId) {
      relatedRows = await db
        .select()
        .from(products)
        .where(
          and(
            eq(products.merchantId, store.merchant.id),
            eq(products.status, 'active'),
            eq(products.categoryId, product.categoryId),
            ne(products.id, product.id)
          )
        )
        .limit(4)
    }

    return ok({
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      price: number(product.price),
      compareAtPrice: product.compareAtPrice === null ? null : number(product.compareAtPrice),
      sku: product.sku,
      trackInventory: product.trackInventory,
      lowStockThreshold: product.lowStockThreshold,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      image,
      images: gallery,
      stock,
      rating: await this.ratingSummary(store.merchant.id, product.id),
      variants: variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        price: number(v.price),
        compareAtPrice: v.compareAtPrice === null ? null : number(v.compareAtPrice),
        inventory: v.inventory,
        optionValues: v.optionValues,
        image: v.image
      })),
      category: category
        ? { id: category.id, name: category.name, slug: category.slug, image: category.image }
        : null,
      related: await this.enrich(store.merchant.id, relatedRows)
    })
  }

  /** Approved-review aggregate for a single product. */
  private static async ratingSummary(merchantId: string, productId: string) {
    const [row] = await db
      .select({
        average: sql<string>`avg(${reviews.rating})`.as('average'),
        count: count()
      })
      .from(reviews)
      .where(and(eq(reviews.merchantId, merchantId), eq(reviews.productId, productId), eq(reviews.status, 'approved')))
    if (!row || Number(row.count) === 0) return null
    return {
      average: Math.round(Number(row.average ?? 0) * 10) / 10,
      count: Number(row.count)
    }
  }

  /** Public approved reviews for a product, with verified-purchase flags. */
  static async productReviews(
    slug: string,
    productSlug: string,
    q: { page?: string; limit?: string }
  ) {
    const store = await this.resolveStore(slug)
    const [product] = await db
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          eq(products.merchantId, store.merchant.id),
          eq(products.status, 'active'),
          eq(products.slug, productSlug)
        )
      )
    if (!product) throw notFound('PRODUCT_NOT_FOUND', 'Product not found')

    const { page, limit, offset } = parsePagination(q)
    const where = and(eq(reviews.productId, product.id), eq(reviews.status, 'approved'))

    const [{ total }] = await db.select({ total: count() }).from(reviews).where(where)
    const rows = await db
      .select({
        id: reviews.id,
        customerId: reviews.customerId,
        authorName: reviews.authorName,
        rating: reviews.rating,
        title: reviews.title,
        body: reviews.body,
        createdAt: reviews.createdAt
      })
      .from(reviews)
      .where(where)
      .orderBy(desc(reviews.createdAt))
      .limit(limit)
      .offset(offset)

    // Verified purchase = the reviewer's customer has a non-cancelled order containing this product.
    let verifiedIds = new Set<string>()
    const customerIds = rows.map((r) => r.customerId).filter((v): v is string => Boolean(v))
    if (customerIds.length > 0) {
      const purchased = await db
        .selectDistinct({ customerId: orders.customerId })
        .from(orders)
        .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
        .where(
          and(
            eq(orders.merchantId, store.merchant.id),
            ne(orders.status, 'cancelled'),
            inArray(orders.customerId, customerIds),
            eq(orderItems.productId, product.id)
          )
        )
      verifiedIds = new Set(purchased.map((p) => p.customerId).filter((v): v is string => Boolean(v)))
    }

    return ok({
      items: rows.map((r) => ({
        id: r.id,
        authorName: r.authorName,
        rating: r.rating,
        title: r.title,
        body: r.body,
        createdAt: r.createdAt,
        verifiedPurchase: r.customerId ? verifiedIds.has(r.customerId) : false
      })),
      meta: makeMeta(page, limit, Number(total))
    })
  }

  static async search(slug: string, q: StorefrontQuery) {
    return this.products(slug, q)
  }

  /* -------------------------------- checkout ------------------------------- */

  private static async resolveItems(
    merchantId: string,
    items: CheckoutItemInput[],
    currency: string
  ): Promise<CheckoutLine[]> {
    const productIds = [...new Set(items.map((i) => i.productId))]
    const variantIds = [...new Set(items.map((i) => i.variantId))]
    // Tenant isolation: only this store's products may enter a checkout. A
    // foreign productId resolves to "not found" — never another merchant's stock.
    const productRows = await db
      .select()
      .from(products)
      .where(and(inArray(products.id, productIds), eq(products.merchantId, merchantId)))
    const variantRows = await db
      .select()
      .from(productVariants)
      .where(inArray(productVariants.id, variantIds))
    const productMap = new Map(productRows.map((p) => [p.id, p]))
    const variantMap = new Map(variantRows.map((v) => [v.id, v]))

    return items.map((item) => {
      const product = productMap.get(item.productId)
      if (!product) throw badRequest('PRODUCT_NOT_FOUND', `Product not found: ${item.productId}`)
      if (product.status !== 'active') {
        throw badRequest('PRODUCT_UNAVAILABLE', `${product.name} is not available`)
      }
      const variant = variantMap.get(item.variantId)
      if (!variant || variant.productId !== product.id) {
        throw badRequest('VARIANT_NOT_FOUND', `Invalid variant for ${product.name}`)
      }
      if (product.trackInventory && variant.inventory < item.quantity) {
        throw badRequest('OUT_OF_STOCK', `Only ${variant.inventory} of ${product.name} available`)
      }
      const price = number(variant.price)
      return {
        productId: product.id,
        variantId: variant.id,
        name: product.name,
        sku: variant.sku ?? product.sku,
        price,
        image: variant.image ?? null,
        optionValues: variant.optionValues,
        trackInventory: product.trackInventory,
        quantity: item.quantity,
        total: roundForCurrency(price * item.quantity, currency)
      }
    })
  }

  private static shippingRate(store: StorePayload, subtotal: number, country?: string) {
    const freeAt = store.shipping.freeShippingThreshold ?? 0
    if (freeAt > 0 && subtotal >= freeAt) return { method: 'Free shipping', rate: 0 }
    const zones = store.shipping.zones
    if (!zones.length) return { method: 'Flat rate', rate: 0 }
    const zone =
      zones.find((z) => !!country && (z.countries ?? []).includes(country)) ?? zones[0]
    if (zone.freeAbove && subtotal >= zone.freeAbove) return { method: zone.name, rate: 0 }
    return { method: zone.name, rate: number(zone.rate) }
  }

  private static taxFor(store: StorePayload, taxable: number, currency: string) {
    if (!store.taxes.autoCalculate) return 0
    const rates = store.taxes.rates
    if (!rates.length) return 0
    return roundForCurrency(taxable * (number(rates[0].rate) / 100), currency)
  }

  private static async buildSummary(
    slug: string,
    body: CheckoutPreviewInput,
    country?: string
  ) {
    const store = await this.resolveStore(slug)
    const currency = store.merchant.currency
    const items = await this.resolveItems(store.merchant.id, body.items, currency)
    const subtotal = roundForCurrency(items.reduce((sum, i) => sum + i.total, 0), currency)

    let coupon: {
      code: string
      type: string
      value: number
      discount: number
      freeShipping: boolean
    } | null = null
    let discountTotal = 0
    if (body.couponCode?.trim()) {
      const { data } = await DiscountsService.validateCoupon(
        store.merchant.id,
        body.couponCode,
        subtotal,
        currency
      )
      coupon = {
        code: body.couponCode.trim().toUpperCase(),
        type: data.coupon.type,
        value: number(data.coupon.value),
        discount: data.discount,
        freeShipping: data.freeShipping
      }
      discountTotal = roundForCurrency(data.discount, currency)
    }

    const shipping = coupon?.freeShipping
      ? { method: 'Free shipping', rate: 0 }
      : this.shippingRate(store, subtotal, country)
    const taxTotal = this.taxFor(store, subtotal - discountTotal + shipping.rate, currency)
    const total = roundForCurrency(subtotal + shipping.rate - discountTotal + taxTotal, currency)

    return { store, items, subtotal, discountTotal, shipping, taxTotal, total, coupon }
  }

  static async preview(slug: string, body: CheckoutPreviewInput) {
    const { store, items, subtotal, discountTotal, shipping, taxTotal, total, coupon } =
      await this.buildSummary(slug, body, body.shippingAddress?.country)
    return ok({
      items,
      subtotal,
      discountTotal,
      shippingTotal: shipping.rate,
      taxTotal,
      total,
      coupon,
      shipping: { method: shipping.method, rate: shipping.rate },
      currency: store.merchant.currency
    })
  }

  /* ------------------------------ payments --------------------------------- */

  private static async assertPaymentMethodAvailable(merchantId: string, method: string) {
    const [payments] = await db
      .select()
      .from(paymentSettings)
      .where(eq(paymentSettings.merchantId, merchantId))
    const manual = (payments?.methods ?? []).some((m) => m.enabled && m.id === method)
    if (manual) return { kind: 'manual' as const }

    const [cfg] = await db
      .select()
      .from(paymentProviderConfigs)
      .where(
        and(
          eq(paymentProviderConfigs.merchantId, merchantId),
          eq(paymentProviderConfigs.provider, method),
          eq(paymentProviderConfigs.enabled, true)
        )
      )
    if (cfg && getProvider(method)) return { kind: 'provider' as const }

    throw badRequest('PAYMENT_METHOD_UNAVAILABLE', `Payment method "${method}" is not available`)
  }

  private static orderUrls(slug: string, providerId: string, orderNumber: string) {
    const storefrontBase = process.env.PUBLIC_STOREFRONT_URL ?? 'http://localhost:5479'
    const apiBase =
      process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 3005}`
    return {
      returnUrl: `${storefrontBase}/${slug}/checkout/return?order=${encodeURIComponent(orderNumber)}`,
      cancelUrl: `${storefrontBase}/${slug}/checkout`,
      webhookUrl: `${apiBase}/api/webhooks/${providerId}/${slug}`
    }
  }

  /** Shared order-creation transaction used by COD checkout and provider checkout/pay. */
  private static async createOrderTx(
    store: Awaited<ReturnType<typeof StorefrontService.resolveStore>>,
    body: CheckoutInput,
    summary: {
      items: CheckoutLine[]
      subtotal: number
      discountTotal: number
      shipping: { rate: number; method: string }
      taxTotal: number
      total: number
      coupon: { code: string } | null
    },
    opts: { paymentStatus: 'unpaid' | 'paid'; provider?: string; expiresAt?: Date | null }
  ) {
    const currency = store.merchant.currency
    // Timestamp component keeps numbers roughly sortable; the random suffix makes
    // them unguessable (public confirmation endpoint) and collision-free.
    const orderNumber = `#W${Date.now().toString(36).toUpperCase()}${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`

    return db.transaction(async (tx) => {
      const email = body.email.trim().toLowerCase()
      let customerId: string | null = null
      const [existing] = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.merchantId, store.merchant.id), eq(customers.email, email)))
      if (existing) {
        customerId = existing.id
        await tx
          .update(customers)
          .set({
            ordersCount: sql`${customers.ordersCount} + 1`,
            lastOrderAt: new Date()
          })
          .where(eq(customers.id, existing.id))
      } else {
        const name = (body.shippingAddress.name as string | undefined) ?? ''
        try {
          const [created] = await tx
            .insert(customers)
            .values({
              merchantId: store.merchant.id,
              email,
              firstName: name.split(' ')[0] ?? null,
              lastName: name.split(' ').slice(1).join(' ') || null,
              phone: (body.shippingAddress.phone as string | undefined) ?? null,
              ordersCount: 1,
              lastOrderAt: new Date()
            })
            .returning()
          customerId = created.id
        } catch (err) {
          // Concurrent first checkout with the same email — reuse the winner's row.
          if ((err as { code?: string }).code !== '23505') throw err
          const [raced] = await tx
            .select()
            .from(customers)
            .where(and(eq(customers.merchantId, store.merchant.id), eq(customers.email, email)))
          if (!raced) throw err
          customerId = raced.id
          await tx
            .update(customers)
            .set({ ordersCount: sql`${customers.ordersCount} + 1`, lastOrderAt: new Date() })
            .where(eq(customers.id, raced.id))
        }
      }

      const [order] = await tx
        .insert(orders)
        .values({
          merchantId: store.merchant.id,
          customerId,
          orderNumber,
          status: 'pending',
          paymentStatus: opts.paymentStatus,
          fulfillmentStatus: 'unfulfilled',
          subtotal: summary.subtotal,
          shippingTotal: summary.shipping.rate,
          discountTotal: summary.discountTotal,
          taxTotal: summary.taxTotal,
          total: summary.total,
          currency,
          shippingAddress: body.shippingAddress,
          billingAddress: body.billingAddress ?? body.shippingAddress,
          notes: body.notes ?? null,
          paymentMethod: body.paymentMethod,
          paymentProvider: opts.provider ?? null,
          couponCode: summary.coupon?.code ?? null,
          attributionChannel: 'direct',
          expiresAt: opts.expiresAt ?? null
        })
        .returning()

      for (const item of summary.items) {
        await tx.insert(orderItems).values({
          orderId: order.id,
          productId: item.productId,
          variantId: item.variantId,
          name: item.name,
          sku: item.sku,
          price: item.price,
          quantity: item.quantity,
          total: item.total
        })
        if (item.trackInventory) {
          // Defence-in-depth: the lock joins the product so a variant can never
          // decrement stock belonging to another merchant, even if callers change.
          const [locked] = await tx
            .select({
              id: productVariants.id,
              inventory: productVariants.inventory,
              merchantId: products.merchantId
            })
            .from(productVariants)
            .innerJoin(products, eq(productVariants.productId, products.id))
            .where(eq(productVariants.id, item.variantId))
            .for('update')
          if (locked && locked.merchantId !== store.merchant.id) {
            throw badRequest('TENANT_MISMATCH', 'Item does not belong to this store')
          }
          if (locked) {
            const before = locked.inventory
            const after = before - item.quantity
            if (after < 0) throw badRequest('OUT_OF_STOCK', `Not enough stock for ${item.name}`)
            await tx
              .update(productVariants)
              .set({ inventory: after })
              .where(eq(productVariants.id, item.variantId))
            await tx.insert(inventoryLogs).values({
              merchantId: store.merchant.id,
              variantId: item.variantId,
              change: -item.quantity,
              beforeValue: before,
              afterValue: after,
              reason: 'sale',
              reference: orderNumber
            })
          }
        }
      }

      if (summary.coupon) {
        // Conditional increment — a concurrent checkout can't push usedCount past usageLimit.
        const claimed = await tx
          .update(coupons)
          .set({ usedCount: sql`${coupons.usedCount} + 1` })
          .where(
            and(
              eq(coupons.merchantId, store.merchant.id),
              eq(coupons.code, summary.coupon.code),
              or(
                isNull(coupons.usageLimit),
                lt(coupons.usedCount, coupons.usageLimit)
              )
            )
          )
          .returning({ id: coupons.id })
        if (claimed.length === 0) {
          throw badRequest('COUPON_USAGE_LIMIT', 'Coupon usage limit reached')
        }
      }

      return order
    })
  }

  static async checkout(slug: string, body: CheckoutInput) {
    const kind = await this.assertPaymentMethodAvailable(
      (await this.resolveStore(slug)).merchant.id,
      body.paymentMethod
    )
    if (kind.kind === 'provider') {
      throw badRequest(
        'PAYMENT_REQUIRES_REDIRECT',
        `"${body.paymentMethod}" requires an online payment session — use /checkout/pay`
      )
    }

    const { store, items, subtotal, discountTotal, shipping, taxTotal, total, coupon } =
      await this.buildSummary(slug, body, body.shippingAddress.country as string | undefined)

    // Legacy "card" demo method is treated as paid-on-place; everything else waits for payment.
    const paymentStatus = body.paymentMethod === 'card' ? 'paid' : 'unpaid'
    const result = await this.createOrderTx(store, body, {
      items,
      subtotal,
      discountTotal,
      shipping,
      taxTotal,
      total,
      coupon
    }, { paymentStatus })

    void EmailsService.orderPlaced(result)

    return ok({
      id: result.id,
      orderNumber: result.orderNumber,
      status: result.status,
      paymentStatus: result.paymentStatus,
      total: number(result.total),
      currency: result.currency,
      email: body.email.trim().toLowerCase(),
      createdAt: result.createdAt
    })
  }

  static async createProviderCheckout(slug: string, body: CheckoutInput) {
    const store = await this.resolveStore(slug)
    const providerId = body.paymentMethod

    const [configRow] = await db
      .select()
      .from(paymentProviderConfigs)
      .where(
        and(
          eq(paymentProviderConfigs.merchantId, store.merchant.id),
          eq(paymentProviderConfigs.provider, providerId),
          eq(paymentProviderConfigs.enabled, true)
        )
      )
    if (!configRow) {
      throw badRequest('PAYMENT_METHOD_UNAVAILABLE', `Payment method "${providerId}" is not available`)
    }
    const adapter = getProvider(providerId)
    if (!adapter) throw badRequest('PROVIDER_ERROR', `Unknown provider "${providerId}"`)

    const { decryptJson } = await import('../../shared/crypto')
    const config = {
      providerId,
      enabled: true,
      mode: (configRow.mode === 'live' ? 'live' : 'test') as 'test' | 'live',
      country: configRow.country ?? null,
      credentials: decryptJson<Record<string, string>>(configRow.credentials)
    }

    const summary = await this.buildSummary(slug, body, body.shippingAddress.country as string | undefined)

    const order = await this.createOrderTx(store, body, {
      items: summary.items,
      subtotal: summary.subtotal,
      discountTotal: summary.discountTotal,
      shipping: summary.shipping,
      taxTotal: summary.taxTotal,
      total: summary.total,
      coupon: summary.coupon
    }, {
      paymentStatus: 'unpaid',
      provider: providerId,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    })

    void EmailsService.orderPlaced(order)

    const urls = this.orderUrls(slug, providerId, order.orderNumber)
    let session
    try {
      session = await adapter.createSession(config, {
        orderId: order.id,
        orderNumber: order.orderNumber,
        total: number(order.total),
        currency: order.currency,
        customer: {
          name: (body.shippingAddress.name as string | undefined) ?? undefined,
          email: body.email.trim().toLowerCase(),
          phone: (body.shippingAddress.phone as string | undefined) ?? undefined
        },
        items: summary.items.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          unitPrice: i.price,
          total: i.total
        })),
        shippingAmount: summary.shipping.rate,
        taxAmount: summary.taxTotal,
        shippingAddress: body.shippingAddress,
        ...urls
      })
    } catch (err) {
      // Session failed → cancel immediately and release the held stock instead of
      // waiting for the expiry sweep (the customer never reached the gateway).
      console.error(`[payments] ${providerId} createSession failed for ${order.orderNumber}:`, err)
      await this.cancelPendingOrder(order)
      throw badRequest(
        'PROVIDER_SESSION_FAILED',
        `Could not start a ${providerId} payment session — please try another payment method`
      )
    }

    await db.insert(paymentTransactions).values({
      merchantId: store.merchant.id,
      orderId: order.id,
      provider: providerId,
      providerRef: session.providerRef,
      status: 'pending',
      amount: number(order.total),
      currency: order.currency,
      raw: session.raw ?? null
    })

    return ok({
      id: order.id,
      orderNumber: order.orderNumber,
      requiresRedirect: true,
      provider: providerId,
      redirectUrl: session.redirectUrl,
      total: number(order.total),
      currency: order.currency
    })
  }

  /**
   * Applies a verified gateway result to the stored transaction and its order.
   * Runs in one transaction with a conditional unpaid→paid flip so concurrent
   * webhook + sync calls can never double-apply (totalSpent, emails, visits).
   */
  static async applyPaymentResult(
    merchantId: string,
    providerId: string,
    result: CallbackResult
  ) {
    const [txn] = await db
      .select()
      .from(paymentTransactions)
      .where(
        and(
          eq(paymentTransactions.provider, providerId),
          eq(paymentTransactions.providerRef, result.providerRef),
          eq(paymentTransactions.merchantId, merchantId)
        )
      )
    if (!txn) throw notFound('TRANSACTION_NOT_FOUND', 'No matching payment transaction')

    // Underpayment / currency mismatch guard — the captured amount must cover
    // the order total before we mark anything paid.
    let status = result.status
    if (status === 'paid') {
      const expected = number(txn.amount)
      if (
        result.amount !== undefined &&
        result.amount + 0.005 < expected
      ) {
        console.error(
          `[payments] underpaid ${result.providerRef}: captured ${result.amount} < expected ${expected} — leaving order unpaid`
        )
        status = 'pending'
      } else if (result.currency && txn.currency && result.currency !== txn.currency) {
        console.error(
          `[payments] currency mismatch for ${result.providerRef}: ${result.currency} != ${txn.currency} — leaving order unpaid`
        )
        status = 'pending'
      }
    }

    const txnStatus = status === 'paid' ? 'paid' : status === 'failed' ? 'failed' : 'pending'

    let orderUpdated = false
    let paidOrderId: string | null = null

    await db.transaction(async (tx) => {
      await tx
        .update(paymentTransactions)
        .set({ status: txnStatus, raw: result.raw ?? txn.raw, updatedAt: new Date() })
        .where(eq(paymentTransactions.id, txn.id))

      if (status !== 'paid') return

      // Conditional flip — only the first caller wins; refunds/cancellations untouched.
      const flipped = await tx
        .update(orders)
        .set({ paymentStatus: 'paid', expiresAt: null, updatedAt: new Date() })
        .where(and(eq(orders.id, txn.orderId), eq(orders.paymentStatus, 'unpaid')))
        .returning()
      if (flipped.length === 0) return

      orderUpdated = true
      paidOrderId = flipped[0].id
      await markOrderPaidEffects(tx, merchantId, flipped[0])
    })

    if (paidOrderId) void EmailsService.orderPaid(merchantId, paidOrderId)

    return { orderUpdated, orderId: txn.orderId }
  }

  /** Cancel a pending unpaid provider order — delegates to the authoritative
   *  shared cancellation (claim + restock + coupon restore).
   *  Returns false when another path (webhook, sweep, sync) already resolved the order. */
  private static async cancelPendingOrder(order: typeof orders.$inferSelect): Promise<boolean> {
    return runCancelPendingOrder(order)
  }

  /** Server-side re-verification used by the storefront return page. */
  static async syncOrder(slug: string, orderNumber: string, payload?: { paymentId?: string }) {
    const store = await this.resolveStore(slug)
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.merchantId, store.merchant.id), eq(orders.orderNumber, orderNumber)))
    if (!order || !order.paymentProvider) {
      throw notFound('ORDER_NOT_FOUND', 'Order not found')
    }

    const adapter = getProvider(order.paymentProvider)
    if (!adapter) throw badRequest('PROVIDER_ERROR', `Unknown provider "${order.paymentProvider}"`)

    const [configRow] = await db
      .select()
      .from(paymentProviderConfigs)
      .where(
        and(
          eq(paymentProviderConfigs.merchantId, store.merchant.id),
          eq(paymentProviderConfigs.provider, order.paymentProvider)
        )
      )
    if (!configRow) throw badRequest('PROVIDER_NOT_CONFIGURED', 'Provider is no longer configured')

    const { decryptJson } = await import('../../shared/crypto')
    const config = {
      providerId: order.paymentProvider,
      enabled: configRow.enabled,
      mode: (configRow.mode === 'live' ? 'live' : 'test') as 'test' | 'live',
      country: configRow.country ?? null,
      credentials: decryptJson<Record<string, string>>(configRow.credentials)
    }

    // Resolve the stored provider reference server-side so "Check now" works for
    // every provider (Tamara needs its own order id, MyFatoorah the paymentId).
    const [txn] = await db
      .select()
      .from(paymentTransactions)
      .where(
        and(
          eq(paymentTransactions.orderId, order.id),
          eq(paymentTransactions.provider, order.paymentProvider)
        )
      )
      .orderBy(desc(paymentTransactions.createdAt))
      .limit(1)

    const result = await adapter.verifyCallback(config, {
      query: payload?.paymentId ? { paymentId: payload.paymentId } : {},
      body: payload?.paymentId ? { paymentId: payload.paymentId } : null,
      headers: {},
      providerRef: txn?.providerRef ?? undefined
    })

    const applied = await this.applyPaymentResult(store.merchant.id, order.paymentProvider, result)
    const [fresh] = await db.select().from(orders).where(eq(orders.id, order.id))
    return ok({
      orderNumber: fresh.orderNumber,
      paymentStatus: fresh.paymentStatus,
      status: fresh.status,
      updated: applied.orderUpdated
    })
  }

  /** Cancels stale unpaid online-payment orders and releases their stock. */
  static async sweepExpiredOrders() {
    const stale = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.status, 'pending'),
          eq(orders.paymentStatus, 'unpaid'),
          lt(orders.expiresAt, new Date())
        )
      )
      .limit(200)

    let cancelled = 0
    for (const order of stale) {
      try {
        const done = await this.cancelPendingOrder(order)
        if (done) cancelled++
      } catch (err) {
        console.error(`[payments] failed to expire order ${order.orderNumber}:`, err)
      }
    }
    return cancelled
  }

  static async order(slug: string, orderNumber: string) {
    const store = await this.resolveStore(slug)
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.merchantId, store.merchant.id), eq(orders.orderNumber, orderNumber)))
    if (!order) throw notFound('ORDER_NOT_FOUND', 'Order not found')

    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id))
    return ok({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      subtotal: number(order.subtotal),
      shippingTotal: number(order.shippingTotal),
      discountTotal: number(order.discountTotal),
      taxTotal: number(order.taxTotal),
      total: number(order.total),
      currency: order.currency,
      // Public endpoint — billing details stay internal; the confirmation page
      // only renders shipping info. Order numbers are CSPRNG-suffixed.
      shippingAddress: order.shippingAddress,
      notes: order.notes,
      createdAt: order.createdAt,
      items: items.map((i) => ({
        id: i.id,
        productId: i.productId,
        variantId: i.variantId,
        name: i.name,
        sku: i.sku,
        price: number(i.price),
        quantity: i.quantity,
        total: number(i.total)
      }))
    })
  }
}
