import { and, asc, count, desc, eq, gte, ilike, inArray, lte, ne, or, sql } from 'drizzle-orm'
import { db } from '../../database/client'
import {
  categories,
  coupons,
  customers,
  inventoryLogs,
  merchants,
  orderItems,
  orders,
  paymentSettings,
  products,
  productVariants,
  shippingSettings,
  storeSettings,
  taxSettings
} from '../../database/schema'
import { DiscountsService } from '../discounts/service'
import { makeMeta, parsePagination } from '../../shared/pagination'
import { ok } from '../../shared/response'
import { badRequest, notFound } from '../../shared/errors'

const number = (v: unknown) => Number(v)
const round = (n: number) => Math.round(n * 100) / 100

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
        currency: payments?.currency ?? merchant.currency
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

  private static async resolveItems(merchantId: string, items: CheckoutItemInput[]): Promise<CheckoutLine[]> {
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
      return {
        productId: product.id,
        variantId: variant.id,
        name: product.name,
        sku: variant.sku ?? product.sku,
        price: number(variant.price),
        image: variant.image ?? null,
        optionValues: variant.optionValues,
        trackInventory: product.trackInventory,
        quantity: item.quantity,
        total: round(number(variant.price) * item.quantity)
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

  private static taxFor(store: StorePayload, taxable: number) {
    if (!store.taxes.autoCalculate) return 0
    const rates = store.taxes.rates
    if (!rates.length) return 0
    return round(taxable * (number(rates[0].rate) / 100))
  }

  private static async buildSummary(
    slug: string,
    body: CheckoutPreviewInput,
    country?: string
  ) {
    const store = await this.resolveStore(slug)
    const items = await this.resolveItems(store.merchant.id, body.items)
    const subtotal = round(items.reduce((sum, i) => sum + i.total, 0))

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
      discountTotal = data.discount
    }

    const shipping = coupon?.freeShipping
      ? { method: 'Free shipping', rate: 0 }
      : this.shippingRate(store, subtotal, country)
    const taxTotal = this.taxFor(store, subtotal - discountTotal + shipping.rate)
    const total = round(subtotal + shipping.rate - discountTotal + taxTotal)

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

  static async checkout(slug: string, body: CheckoutInput) {
    const { store, items, subtotal, discountTotal, shipping, taxTotal, total, coupon } =
      await this.buildSummary(slug, body, body.shippingAddress.country as string | undefined)
    const orderNumber = `#W${Date.now().toString(36).toUpperCase()}`

    const result = await db.transaction(async (tx) => {
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
            totalSpent: Number(existing.totalSpent) + total,
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
            totalSpent: total,
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
          paymentStatus: 'paid',
          fulfillmentStatus: 'unfulfilled',
          subtotal,
          shippingTotal: shipping.rate,
          discountTotal,
          taxTotal,
          total,
          currency: store.merchant.currency,
          shippingAddress: body.shippingAddress,
          billingAddress: body.billingAddress ?? body.shippingAddress,
          notes: body.notes ?? null
        })
        .returning()

      for (const item of items) {
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

      if (coupon) {
        await tx
          .update(coupons)
          .set({ usedCount: sql`${coupons.usedCount} + 1` })
          .where(and(eq(coupons.merchantId, store.merchant.id), eq(coupons.code, coupon.code)))
      }

      return order
    })

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
