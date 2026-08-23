import { and, asc, count, desc, eq, gte, ilike, inArray, lt, lte, ne, or, sql } from 'drizzle-orm'
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
  products,
  productVariants,
  shippingSettings,
  storeSettings,
  taxSettings
} from '../../database/schema'
import { DiscountsService } from '../discounts/service'
import { makeMeta, parsePagination } from '../../shared/pagination'
import { roundForCurrency } from '../../shared/currency'
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
      const image =
        productVariants_.find((v) => v.image)?.image ?? category?.image ?? null
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
    if (search) {
      const cond = or(
        ilike(products.name, `%${search}%`),
        ilike(products.description, `%${search}%`)
      )
      if (cond) conditions.push(cond)
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
        ? asc(products.price)
        : q.sort === 'price_desc'
          ? desc(products.price)
          : desc(products.createdAt)
    const rows = await db
      .select()
      .from(products)
      .where(where)
      .orderBy(orderBy)
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
    const image = variants.find((v) => v.image)?.image ?? category?.image ?? null

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
      stock,
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
    const productRows = await db.select().from(products).where(inArray(products.id, productIds))
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
        subtotal
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
      await this.buildSummary(slug, body)
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
    const orderNumber = `#W${Date.now().toString(36).toUpperCase()}`

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
            ordersCount: existing.ordersCount + 1,
            lastOrderAt: new Date()
          })
          .where(eq(customers.id, existing.id))
      } else {
        const name = (body.shippingAddress.name as string | undefined) ?? ''
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
          const [variant] = await tx
            .select()
            .from(productVariants)
            .where(eq(productVariants.id, item.variantId))
            .for('update')
          if (variant) {
            const before = variant.inventory
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
        await tx
          .update(coupons)
          .set({ usedCount: sql`${coupons.usedCount} + 1` })
          .where(
            and(
              eq(coupons.merchantId, store.merchant.id),
              eq(coupons.code, summary.coupon.code)
            )
          )
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
        items: summary.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.price })),
        shippingAddress: body.shippingAddress,
        ...urls
      })
    } catch (err) {
      // Leave the order to expire via the sweep so held stock is released.
      console.error(`[payments] ${providerId} createSession failed for ${order.orderNumber}:`, err)
      throw err
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

  /** Applies a verified gateway result to the stored transaction and its order. */
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

    const txnStatus =
      result.status === 'paid' ? 'paid' : result.status === 'failed' ? 'failed' : 'pending'
    await db
      .update(paymentTransactions)
      .set({ status: txnStatus, raw: result.raw ?? txn.raw, updatedAt: new Date() })
      .where(eq(paymentTransactions.id, txn.id))

    let orderUpdated = false
    if (result.status === 'paid') {
      const [order] = await db.select().from(orders).where(eq(orders.id, txn.orderId))
      // Only flip unpaid → paid; refunds/cancellations stay untouched.
      if (order && order.paymentStatus === 'unpaid') {
        await db
          .update(orders)
          .set({ paymentStatus: 'paid', expiresAt: null, updatedAt: new Date() })
          .where(eq(orders.id, order.id))
        if (order.customerId) {
          const [customer] = await db
            .select()
            .from(customers)
            .where(eq(customers.id, order.customerId))
          if (customer) {
            await db
              .update(customers)
              .set({
                totalSpent: number(customer.totalSpent) + number(order.total),
                lastOrderAt: order.createdAt
              })
              .where(eq(customers.id, order.customerId))
          }
        }
        orderUpdated = true
      }
    }

    return { orderUpdated, orderId: txn.orderId }
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

    const result = await adapter.verifyCallback(config, {
      query: payload?.paymentId ? { paymentId: payload.paymentId } : {},
      body: payload?.paymentId ? { paymentId: payload.paymentId } : null,
      headers: {}
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

    for (const order of stale) {
      try {
        await db.transaction(async (tx) => {
          const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id))
          for (const item of items) {
            if (!item.variantId) continue
            const [variant] = await tx
              .select()
              .from(productVariants)
              .where(eq(productVariants.id, item.variantId))
              .for('update')
            if (!variant) continue
            const afterValue = variant.inventory + item.quantity
            await tx
              .update(productVariants)
              .set({ inventory: afterValue })
              .where(eq(productVariants.id, variant.id))
            await tx.insert(inventoryLogs).values({
              merchantId: order.merchantId,
              variantId: variant.id,
              change: item.quantity,
              beforeValue: variant.inventory,
              afterValue,
              reason: 'cancel',
              reference: order.orderNumber
            })
          }
          await tx
            .update(orders)
            .set({ status: 'cancelled', paymentStatus: 'failed', updatedAt: new Date() })
            .where(eq(orders.id, order.id))
        })
      } catch (err) {
        console.error(`[payments] failed to expire order ${order.orderNumber}:`, err)
      }
    }
    return stale.length
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
      shippingAddress: order.shippingAddress,
      billingAddress: order.billingAddress,
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
