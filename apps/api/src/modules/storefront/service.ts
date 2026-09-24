import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db, db as platformDb, type DB } from '../../database/client'
import { PUBLIC_STATUSES } from '../../shared/merchant-lifecycle'
import { createLogger } from '../../shared/logger'

const log = createLogger('storefront')
import {
  categories,
  checkoutSettings,
  codRules,
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
  productOptions,
  productOptionValues,
  products,
  productVariants,
  promotions,
  reviews,
  shippingSettings,
  storeSettings,
  taxSettings,
  visits,
  warehouseInventory,
  warehouses
} from '../../database/schema'
import { DEFAULT_CHECKOUT_REQUIRED_FIELDS } from '../../shared/types'
import type { CheckoutFieldRequirements, ShippingRule } from '../../shared/types'
import { DiscountsService } from '../discounts/service'
import { EmailsService } from '../emails/service'
import { awardForOrder } from '../loyalty/engine'
import { attributeOrder } from '../affiliates/service'
import { CartsService } from '../carts/service'
import { OrdersService } from '../orders/service'
import { makeMeta, parsePagination } from '../../shared/pagination'
import { runCancelPendingOrder } from '../../shared/order-cancel'
import { markOrderPaidEffects } from '../../shared/order-payments'
import { emit } from '../../shared/event-dispatch'
import { roundForCurrency } from '../../shared/currency'
import { productSearchCondition, productSearchRank } from '../../shared/product-search'
import { getProvider, listProviders } from '../../payments/registry'
import { ok } from '../../shared/response'
import { badRequest, notFound } from '../../shared/errors'
import {
  assertShippingSupported,
  computeShippingRate,
  validateRequiredFields
} from './shipping'

const number = (v: unknown) => Number(v)

/** A retail product is available on the storefront when a merchant has not
 *  restricted it to POS only (visibility ∈ website | both). */
const visibleOnWeb = () => inArray(products.visibility, ['website', 'both'])
const webVisible = visibleOnWeb

export interface CheckoutItemInput {
  productId: string
  variantId: string
  quantity: number
  selections?: Array<{ optionId: string; values: string[] }>
}

export interface CheckoutInput extends CheckoutPreviewInput {
  email: string
  /** Affiliate referral code (?ref=); attributes commission on order placement. */
  referralCode?: string
  shippingAddress: CheckoutAddress
  billingAddress?: CheckoutAddress
  paymentMethod: string
  notes?: string
  cartId?: string
  /** Warehouse to fulfill this order from. Defaults to the merchant's default active warehouse when set. */
  fulfillmentWarehouseId?: string
  /** Client-generated key (e.g. crypto.randomUUID) — same key = same logical
   *  checkout attempt; retries return the original order instead of a duplicate. */
  idempotencyKey?: string
}

export interface CheckoutPreviewInput {
  items: CheckoutItemInput[]
  couponCode?: string
  /** Optional country so previewed totals match the final order's shipping/tax. */
  shippingAddress?: { country?: string; state?: string; city?: string; postalCode?: string }
}

/** Drizzle transaction type used inside `db.transaction(async (tx) => ...)`. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Resolve the warehouse that fulfills an order. Returns the explicit override if
 * it belongs to the merchant and is active, else the merchant's default active
 * warehouse, else null when the merchant has no usable warehouse. Unknown/no
 * warehouse is a no-op (legacy global-inventory behavior) rather than an error.
 */
async function resolveFulfillingWarehouse(
  db: DB,
  merchantId: string,
  overrideId?: string
): Promise<string | null> {
  if (overrideId) {
    const [wh] = await db
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.id, overrideId), eq(warehouses.merchantId, merchantId)))
    if (wh && wh.status === 'active') return wh.id
  }
  const [def] = await db
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.merchantId, merchantId), eq(warehouses.isDefault, true)))
    .limit(1)
  if (def && def.status === 'active') return def.id
  return null
}

/**
 * Decrement a warehouse's stock for a variant as order fulfillment. The decrement
 * never goes below 0 and skips variants the warehouse doesn't stock (no row).
 * Runs inside the checkout transaction so it's atomic with the order + global
 * inventory decrement.
 */
async function allocateWarehouseStock(
  tx: Tx,
  merchantId: string,
  warehouseId: string,
  variantId: string,
  quantity: number
): Promise<void> {
  const [row] = await tx
    .select()
    .from(warehouseInventory)
    .where(
      and(
        eq(warehouseInventory.warehouseId, warehouseId),
        eq(warehouseInventory.variantId, variantId)
      )
    )
    .for('update')
  if (!row || row.quantity <= 0) return
  await tx
    .update(warehouseInventory)
    .set({ quantity: Math.max(0, row.quantity - quantity), updatedAt: new Date() })
    .where(eq(warehouseInventory.id, row.id))
}

interface StorePayload {
  merchant: {
    id: string
    name: string
    slug: string
    currency: string
    timezone: string
    /** Merchant home country (ISO 2–3 char) — storefront country default +
     *  server-side delivery restriction. */
    country: string | null
  }
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
    /** Hierarchical rules: pin > city > state > country > default. */
    rules: ShippingRule[]
    freeShippingThreshold: number
  }
  checkout: {
    /** Which address/contact fields the merchant requires at checkout. */
    requiredFields: CheckoutFieldRequirements
  }
  taxes: {
    autoCalculate: boolean
    rates: Array<{ region: string; rate: number }>
  }
}

export interface CheckoutAddress {
  name?: string
  line1?: string
  line2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  phone?: string
}

interface CheckoutLine {
  productId: string
  variantId: string
  name: string
  sku: string | null
  price: number
  image: string | null
  categoryId: string | null
  optionValues: Record<string, string>
  /** Validated custom-option picks (option name → chosen values). */
  customSelections: Record<string, string[]>
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
  nameAr: string | null
  slug: string
  image: string | null
}

interface PublicProduct {
  id: string
  merchantId: string
  name: string
  nameAr: string | null
  slug: string
  description: string
  descriptionAr: string
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

  /**
   * Pre-tenant lookup only — runs on the admin connection (merchant isn't
   * known yet). Callers open a tenant connection with the returned id before
   * touching anything else.
   */
  static async resolveMerchantId(slug: string) {
    const [merchant] = await db
      .select({ id: merchants.id })
      .from(merchants)
      .where(and(eq(merchants.slug, slug), inArray(merchants.status, PUBLIC_STATUSES)))
    if (!merchant) throw notFound('STORE_NOT_FOUND', 'Store not found')
    return merchant.id
  }

  /**
   * Admin-only (read-only catalog callers) and tenant-scoped (checkout chain)
   * share one implementation: the single-arg overload resolves the merchant on
   * the platform admin connection; the two-arg overload routes the merchant
   * lookup through the caller's tenant connection (RLS-enforced).
   */
  static async resolveStore(slug: string): Promise<StorePayload>
  static async resolveStore(db: DB, slug: string): Promise<StorePayload>
  static async resolveStore(dbOrSlug: DB | string, maybeSlug?: string): Promise<StorePayload> {
    const db = typeof dbOrSlug === 'string' ? platformDb : dbOrSlug
    const slug = typeof dbOrSlug === 'string' ? dbOrSlug : (maybeSlug as string)
    const [merchant] = await db
      .select()
      .from(merchants)
      .where(and(eq(merchants.slug, slug), inArray(merchants.status, PUBLIC_STATUSES)))
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
    const [checkout] = await db
      .select()
      .from(checkoutSettings)
      .where(eq(checkoutSettings.merchantId, merchant.id))
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
        timezone: merchant.timezone,
        country: merchant.country
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
        rules: shipping?.rules ?? [],
        freeShippingThreshold: number(shipping?.freeShippingThreshold ?? 0)
      },
      checkout: {
        requiredFields: checkout?.requiredFields ?? DEFAULT_CHECKOUT_REQUIRED_FIELDS
      },
      taxes: {
        autoCalculate: taxes?.autoCalculate ?? true,
        rates: taxes?.rates ?? []
      }
    }
  }

  static async store(db: DB, slug: string) {
    return ok(await this.resolveStore(db, slug))
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

  static async sitemap(db: DB, slug: string) {
    const store = await this.resolveStore(db, slug)
    const productRows = await db
      .select({ slug: products.slug })
      .from(products)
      .where(
        and(eq(products.merchantId, store.merchant.id), eq(products.status, 'active'), visibleOnWeb())
      )
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
    db: DB,
    slug: string,
    body: { type: 'view' | 'cart_add' | 'checkout_start'; channel?: string }
  ) {
    const store = await this.resolveStore(db, slug)
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

  static async categories(db: DB, slug: string) {
    const store = await this.resolveStore(db, slug)
    const rows = await db
      .select()
      .from(categories)
      .where(and(eq(categories.merchantId, store.merchant.id), eq(categories.status, 'active')))
      .orderBy(asc(categories.sortOrder), asc(categories.name))

    const productCounts = await db
      .select({ categoryId: products.categoryId, count: count() })
      .from(products)
      .where(
        and(
          eq(products.merchantId, store.merchant.id),
          eq(products.status, 'active'),
          visibleOnWeb()
        )
      )
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
        nameAr: cat.nameAr,
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

  private static async categoryAndDescendants(db: DB, merchantId: string, categorySlug: string) {
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
    db: DB,
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
        nameAr: p.nameAr,
        slug: p.slug,
        description: p.description,
        descriptionAr: p.descriptionAr,
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
          ? {
              id: category.id,
              name: category.name,
              nameAr: category.nameAr,
              slug: category.slug,
              image: category.image
            }
          : null
      } as PublicProduct
    })
  }

  static async products(db: DB, slug: string, q: StorefrontQuery) {
    const store = await this.resolveStore(db, slug)
    const { page, limit, offset } = parsePagination(q)
    const conditions = [
      eq(products.merchantId, store.merchant.id),
      eq(products.status, 'active'),
      visibleOnWeb()
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
      const ids = await this.categoryAndDescendants(db, store.merchant.id, q.category)
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
      items: await this.enrich(db, store.merchant.id, rows),
      meta: makeMeta(page, limit, Number(total))
    })
  }

  static async product(db: DB, slug: string, productSlug: string) {
    const store = await this.resolveStore(db, slug)
    const [product] = await db
      .select()
      .from(products)
      .where(
        and(
          eq(products.merchantId, store.merchant.id),
          eq(products.status, 'active'),
          eq(products.slug, productSlug),
          visibleOnWeb()
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
            ne(products.id, product.id),
            visibleOnWeb()
          )
        )
        .limit(4)
    }

    return ok({
      id: product.id,
      name: product.name,
      nameAr: product.nameAr,
      slug: product.slug,
      description: product.description,
      descriptionAr: product.descriptionAr,
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
      rating: await this.ratingSummary(db, store.merchant.id, product.id),
      variants: variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        price: number(v.price),
        compareAtPrice: v.compareAtPrice === null ? null : number(v.compareAtPrice),
        inventory: v.inventory,
        unlimited: v.unlimited,
        optionValues: v.optionValues,
        optionValuesAr: v.optionValuesAr,
        image: v.image
      })),
      options: await this.optionsFor(db, store.merchant.id, product.id),
      category: category
        ? {
            id: category.id,
            name: category.name,
            nameAr: category.nameAr,
            slug: category.slug,
            image: category.image
          }
        : null,
      related: await this.enrich(db, store.merchant.id, relatedRows)
    })
  }

  /** Option definitions for a product, with their values (storefront-facing). */
  private static async optionsFor(db: DB, merchantId: string, productId: string) {
    const opts = await db
      .select()
      .from(productOptions)
      .where(and(eq(productOptions.productId, productId), eq(productOptions.status, 'active')))
      .orderBy(asc(productOptions.sortOrder), asc(productOptions.createdAt))
    if (!opts.length) return []
    const values = await db
      .select()
      .from(productOptionValues)
      .where(
        and(
          inArray(productOptionValues.optionId, opts.map((o) => o.id)),
          eq(productOptionValues.status, 'active')
        )
      )
      .orderBy(asc(productOptionValues.sortOrder), asc(productOptionValues.createdAt))
    return opts.map((o) => ({
      id: o.id,
      name: o.name,
      nameAr: o.nameAr,
      type: o.type,
      required: o.required,
      minSelections: o.minSelections,
      maxSelections: o.maxSelections,
      perValueQuantity: o.allowControl.perValueQuantity,
      values: values
        .filter((v) => v.optionId === o.id)
        .map((v) => ({
          value: v.value,
          valueAr: v.valueAr,
          priceAdjustment: number(v.priceAdjustment),
          quantity: v.quantity
        }))
    }))
  }

  /** Approved-review aggregate for a single product. */
  private static async ratingSummary(db: DB, merchantId: string, productId: string) {
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
    db: DB,
    slug: string,
    productSlug: string,
    q: { page?: string; limit?: string }
  ) {
    const store = await this.resolveStore(db, slug)
    const [product] = await db
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          eq(products.merchantId, store.merchant.id),
          eq(products.status, 'active'),
          eq(products.slug, productSlug),
          visibleOnWeb()
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

  static async search(db: DB, slug: string, q: StorefrontQuery) {
    return this.products(db, slug, q)
  }

  /* -------------------------------- checkout ------------------------------- */

  private static async resolveItems(
    db: DB,
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

    // Custom-option definitions for selection validation (required/min/max,
    // known values, price adjustments). Only active options participate.
    const optionRows = productIds.length
      ? await db
          .select()
          .from(productOptions)
          .where(
            and(
              inArray(productOptions.productId, productIds),
              eq(productOptions.merchantId, merchantId),
              eq(productOptions.status, 'active')
            )
          )
      : []
    const optionIds = optionRows.map((o) => o.id)
    const valueRows = optionIds.length
      ? await db
          .select()
          .from(productOptionValues)
          .where(
            and(
              inArray(productOptionValues.optionId, optionIds),
              eq(productOptionValues.merchantId, merchantId)
            )
          )
      : []
    const optionsByProduct = new Map<string, typeof optionRows>()
    for (const o of optionRows) {
      if (!optionsByProduct.has(o.productId)) optionsByProduct.set(o.productId, [])
      optionsByProduct.get(o.productId)!.push(o)
    }
    const valuesByOption = new Map<string, typeof valueRows>()
    for (const v of valueRows) {
      if (!valuesByOption.has(v.optionId)) valuesByOption.set(v.optionId, [])
      valuesByOption.get(v.optionId)!.push(v)
    }

    return items.map((item) => {
      const product = productMap.get(item.productId)
      if (!product) throw badRequest('PRODUCT_NOT_FOUND', `Product not found: ${item.productId}`)
      if (product.status !== 'active') {
        throw badRequest('PRODUCT_UNAVAILABLE', `${product.name} is not available`)
      }
      if (product.visibility === 'pos') {
        throw badRequest('PRODUCT_UNAVAILABLE', `${product.name} is not available online`)
      }
      const variant = variantMap.get(item.variantId)
      if (!variant || variant.productId !== product.id) {
        throw badRequest('VARIANT_NOT_FOUND', `Invalid variant for ${product.name}`)
      }
      if (product.trackInventory && !variant.unlimited && variant.inventory < item.quantity) {
        throw badRequest('OUT_OF_STOCK', `Only ${variant.inventory} of ${product.name} available`)
      }
      // Server-side custom-option enforcement: every required option (or one
      // with minSelections > 0) must be present, counts must sit inside
      // [min, max], and option ids + values must belong to this product.
      // Forged requests cannot bypass what the storefront validates in UI.
      const defs = optionsByProduct.get(product.id) ?? []
      const defById = new Map(defs.map((d) => [d.id, d]))
      const seenOptions = new Set<string>()
      let adjustment = 0
      const customSelections: Record<string, string[]> = {}
      for (const sel of item.selections ?? []) {
        const def = defById.get(sel.optionId)
        if (!def) throw badRequest('INVALID_OPTION', `Unknown option for ${product.name}`)
        if (seenOptions.has(sel.optionId)) throw badRequest('INVALID_OPTION', `Duplicate option for ${product.name}`)
        seenOptions.add(sel.optionId)
        const known = new Map((valuesByOption.get(def.id) ?? []).map((v) => [v.value, v]))
        const isFreeInput = def.type === 'number' || def.type === 'text'
        if (!isFreeInput) {
          for (const val of sel.values) {
            if (!known.has(val)) throw badRequest('INVALID_OPTION_VALUE', `"${val}" is not a valid choice for ${def.name}`)
          }
        }
        if (sel.values.length < def.minSelections || (def.maxSelections > 0 && sel.values.length > def.maxSelections)) {
          throw badRequest(
            'INVALID_OPTION_SELECTION',
            `${def.name} allows between ${def.minSelections} and ${def.maxSelections} selections`
          )
        }
        for (const val of sel.values) {
          adjustment += Number(known.get(val)?.priceAdjustment ?? 0)
        }
        customSelections[def.name] = [...sel.values]
      }
      for (const def of defs) {
        const min = def.required ? Math.max(1, def.minSelections) : def.minSelections
        if (min > 0 && !seenOptions.has(def.id)) {
          throw badRequest('OPTION_REQUIRED', `"${def.name}" is required for ${product.name}`)
        }
      }
      const price = roundForCurrency(number(variant.price) + adjustment, currency)
      return {
        productId: product.id,
        variantId: variant.id,
        name: product.name,
        sku: variant.sku ?? product.sku,
        price,
        image: variant.image ?? null,
        categoryId: product.categoryId ?? null,
        optionValues: variant.optionValues,
        customSelections,
        trackInventory: product.trackInventory && !variant.unlimited,
        quantity: item.quantity,
        total: roundForCurrency(price * item.quantity, currency)
      }
    })
  }

  private static shippingRate(
    store: StorePayload,
    subtotal: number,
    location?: CheckoutAddress
  ) {
    return computeShippingRate(
      {
        zones: store.shipping.zones,
        rules: store.shipping.rules,
        freeAt: store.shipping.freeShippingThreshold ?? 0
      },
      subtotal,
      {
        country: location?.country,
        state: location?.state,
        city: location?.city,
        postalCode: location?.postalCode
      }
    )
  }

  /**
   * Delivery-country restriction (PDF-correction): when a merchant sets their
   * home country — and no shipping zones carry explicit country lists — the
   * storefront may only deliver to that country (KW merchant → Kuwait only).
   * Explicit zone countries still win, with the merchant's country always
   * accepted.
   */
  private static assertShippingSupported(store: StorePayload, country?: string) {
    assertShippingSupported(
      { zones: store.shipping.zones, merchantCountry: store.merchant.country },
      country
    )
  }

  /** Merchant-configurable required checkout fields (email default-optional). */
  private static validateRequiredFields(
    store: StorePayload,
    address: CheckoutAddress | undefined
  ) {
    validateRequiredFields(
      store.checkout.requiredFields,
      address as Record<string, unknown> | undefined
    )
  }

  private static taxFor(
    store: StorePayload,
    taxable: number,
    currency: string,
    location?: { country?: string; state?: string }
  ) {
    if (!store.taxes.autoCalculate) return 0
    const rates = store.taxes.rates
    if (!rates.length) return 0
    // Region resolution (P1-11): most specific configured match wins —
    // "US-NY" style combos, then bare state, then bare country, then an
    // empty-region default row. Case-insensitive because merchants type
    // regions free-form ("us", "US").
    const norm = (v?: string) => v?.trim().toLowerCase() ?? ''
    const c = norm(location?.country)
    const s = norm(location?.state)
    const row =
      (c && s && rates.find((r) => norm(r.region) === `${c}-${s}`)) ??
      (s ? rates.find((r) => norm(r.region) === s) : undefined) ??
      (c ? rates.find((r) => norm(r.region) === c) : undefined) ??
      rates.find((r) => !r.region?.trim())
    if (!row) return 0
    return roundForCurrency(taxable * (number(row.rate) / 100), currency)
  }

  private static async buildSummary(
    db: DB,
    slug: string,
    body: CheckoutPreviewInput
  ) {
    const store = await this.resolveStore(db, slug)
    const currency = store.merchant.currency
    const items = await this.resolveItems(db, store.merchant.id, body.items, currency)
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
      // `db` here is the tenant connection threaded through buildSummary — the
      // discounted rows (coupons) are merchant-scoped and must not fall back
      // to the BYPASSRLS admin singleton.
      const { data } = await DiscountsService.validateCoupon(db, 
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

    // Server-side promotion resolution (P0-05) — the best active promotion is
    // applied automatically, before coupons, and never trusts client totals.
    // (`db` = the tenant connection threaded through buildSummary.)
    const promo = await DiscountsService.resolvePromotion(db, 
      store.merchant.id,
      currency,
      items.map((l) => ({
        productId: l.productId,
        categoryId: l.categoryId,
        price: l.price,
        quantity: l.quantity
      }))
    )
    let promotionDiscount = 0
    if (promo && promo.discount > 0) {
      promotionDiscount = promo.discount
      discountTotal = roundForCurrency(
        Math.min(promotionDiscount + discountTotal, subtotal), // combined discounts can never invert the cart
        currency
      )
    }

    const address = body.shippingAddress as CheckoutAddress | undefined
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
    const shipping = coupon?.freeShipping
      ? { method: 'Free shipping', rate: 0 }
      : this.shippingRate(store, subtotal, {
          country: str(address?.country),
          state: str(address?.state),
          city: str(address?.city),
          postalCode: str(address?.postalCode)
        })
    const taxTotal = this.taxFor(
      store,
      subtotal - discountTotal + shipping.rate,
      currency,
      {
        country: str(address?.country),
        state: str(address?.state)
      }
    )
    const total = roundForCurrency(subtotal + shipping.rate - discountTotal + taxTotal, currency)

    return {
      store,
      items,
      subtotal,
      discountTotal,
      promotionDiscount,
      promotion: promo ? { id: promo.promotion.id, name: promo.promotion.name } : null,
      shipping,
      taxTotal,
      total,
      coupon
    }
  }

  static async preview(db: DB, slug: string, body: CheckoutPreviewInput) {
    const summary = await this.buildSummary(db, slug, body)
    return ok({
      items: summary.items,
      subtotal: summary.subtotal,
      discountTotal: summary.discountTotal,
      promotion: summary.promotion,
      shippingTotal: summary.shipping.rate,
      taxTotal: summary.taxTotal,
      total: summary.total,
      coupon: summary.coupon,
      shipping: { method: summary.shipping.method, rate: summary.shipping.rate },
      currency: summary.store.merchant.currency
    })
  }

  /* ------------------------------ payments --------------------------------- */

  private static async assertPaymentMethodAvailable(db: DB, merchantId: string, method: string) {
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

  /**
   * Enforce COD rules + pincode serviceability at checkout when the chosen
   * method is a manual COD method. Non-COD methods pass through untouched.
   */
  private static async assertCodAvailable(
    db: DB,
    merchantId: string,
    method: string,
    total: number,
    shippingAddress?: CheckoutAddress
  ) {
    const [payments] = await db
      .select()
      .from(paymentSettings)
      .where(eq(paymentSettings.merchantId, merchantId))
    const manualMethod = (payments?.methods ?? []).find((m) => m.enabled && m.id === method)
    // Only constrain cash-on-delivery style methods.
    if (!manualMethod || !['cod', 'cash_on_delivery', 'posta', 'postinbjudan'].includes(method)) {
      return
    }

    const [checkout] = await db
      .select()
      .from(checkoutSettings)
      .where(eq(checkoutSettings.merchantId, merchantId))
    const [rules] = await db
      .select()
      .from(codRules)
      .where(eq(codRules.merchantId, merchantId))

    // COD enabled flag (checkout settings takes precedence).
    const codEnabled = checkout?.codEnabled ?? rules?.enabled ?? true
    if (!codEnabled) {
      throw badRequest('COD_UNAVAILABLE', 'Cash on delivery is currently unavailable')
    }

    // Order value range check.
    const min = checkout?.codMinValue ?? rules?.minOrderValue ?? 0
    const max = checkout?.codMaxValue !== undefined ? checkout?.codMaxValue : rules?.maxOrderValue
    if (total < Number(min)) {
      throw badRequest('COD_MIN_VALUE', `Cash on delivery requires a minimum order of ${min}`)
    }
    if (max !== null && max !== undefined && total > Number(max)) {
      throw badRequest('COD_MAX_VALUE', 'Order is above the cash-on-delivery maximum')
    }

    // Pincode serviceability — if any pincodes are configured, the shipping
    // pincode must be in the serviceable list and not blacklisted.
    const pincode = (shippingAddress?.postalCode ?? '').trim()
    const serviceable = checkout?.serviceablePincodes ?? []
    const blacklist = rules?.blacklistPincodes ?? []
    if (serviceable.length > 0 && !serviceable.includes(pincode)) {
      throw badRequest('PINCODE_NOT_SERVICEABLE', 'Cash on delivery is not available to this pincode')
    }
    if (blacklist.includes(pincode)) {
      throw badRequest('PINCODE_NOT_SERVICEABLE', 'Cash on delivery is not available to this pincode')
    }
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
    db: DB,
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
      promotionId?: string | null
    },
    opts: { paymentStatus: 'unpaid' | 'paid'; provider?: string; expiresAt?: Date | null }
  ) {
    const currency = store.merchant.currency
    // 128-bit random order number — unguessable and collision-free.
    // Format: #W-XXXXXXXX-XXXXXXXX (8 hex chars per segment, 16 hex = 64 bits + prefix)
    const seg1 = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()
    const seg2 = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()
    const orderNumber = `#W-${seg1}-${seg2}`

    // Resolve the fulfilling warehouse: explicit override, else the merchant's
    // default active warehouse. Null when the merchant has no warehouses set up
    // (legacy single-location behavior — no warehouse accounting happens).
    const fulfillingWarehouseId = await resolveFulfillingWarehouse(
      db,
      store.merchant.id,
      body.fulfillmentWarehouseId
    )

    const placedOrder = await db.transaction(async (tx) => {
      // Acquire ALL variant locks FIRST — before customer/order/quota writes —
      // so every checkout transaction takes row locks in one global order.
      // Concurrent checkouts then queue on the variant instead of deadlocking
      // across mixed resource orders.
      const lockedVariants = new Map<string, number>()
      for (const item of summary.items.filter((i) => i.trackInventory)) {
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
        if (!locked) continue
        if (locked.merchantId !== store.merchant.id) {
          throw badRequest('TENANT_MISMATCH', 'Item does not belong to this store')
        }
        lockedVariants.set(locked.id, locked.inventory)
      }

      const email = body.email.trim().toLowerCase()
      // Guest checkout (no email): skip the customer row entirely — customers
      // requires a non-empty email and '' would collide on the per-merchant
      // unique index across guest orders. The order keeps customerId null.
      let customerId: string | null
      if (!email) {
        customerId = null
      } else {
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
          emit(store.merchant.id, 'customer.created', { customerId: created.id, email: created.email })
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
          shippingAddress: body.shippingAddress as Record<string, unknown>,
          billingAddress: (body.billingAddress ?? body.shippingAddress) as Record<string, unknown>,
          notes: body.notes ?? null,
          paymentMethod: body.paymentMethod,
          paymentProvider: opts.provider ?? null,
          couponCode: summary.coupon?.code ?? null,
          promotionId: summary.promotionId ?? null,
          attributionChannel: body.referralCode?.trim() ? 'affiliate' : 'direct',
          warehouseId: fulfillingWarehouseId,
          idempotencyKey: body.idempotencyKey ?? null,
          expiresAt: opts.expiresAt ?? null
        })
        .returning()

      // Orders born paid (legacy "card" paid-on-place) still need a real payment
      // transaction row + the paid effects (customer spend, funnel) — otherwise
      // the dashboard "no transaction" refund/journal/analytics paths break.
      if (opts.paymentStatus === 'paid') {
        await tx.insert(paymentTransactions).values({
          merchantId: store.merchant.id,
          orderId: order.id,
          provider: opts.provider ?? 'card',
          providerRef: null,
          status: 'paid',
          amount: summary.total,
          currency
        })
        await markOrderPaidEffects(tx, store.merchant.id, order)
      }

      // Coupon + promotion quota claims come BEFORE the variant locks so every
      // transaction acquires row locks in the same order (quota rows → variant
      // rows). Mixed acquisition orders deadlocked under concurrent checkouts.
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

      if (summary.promotionId) {
        // Same race-safe claim for promotion usage — the whole order rolls
        // back if the limit was hit between pricing and commit.
        const [claimedPromo] = await tx
          .update(promotions)
          .set({ usedCount: sql`${promotions.usedCount} + 1` })
          .where(
            and(
              eq(promotions.id, summary.promotionId),
              eq(promotions.merchantId, store.merchant.id),
              or(
                isNull(promotions.usageLimit),
                lt(promotions.usedCount, promotions.usageLimit)
              )
            )
          )
          .returning({ id: promotions.id })
        if (!claimedPromo) {
          throw badRequest('PROMOTION_USAGE_LIMIT', 'Promotion usage limit reached')
        }
      }

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
          // Already locked at the top of the transaction — reuse that snapshot.
          const before = lockedVariants.get(item.variantId)
          if (before === undefined) continue
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

          // Per-value option inventory: values flagged with their own
          // quantity participate in the sale. Decrement each matched value
          // (clamped at 0, negative → OUT_OF_STOCK) in the same transaction.
          // Covers both variant-baked picks and custom selections.
          const optEntries = [
            ...Object.entries((item.optionValues ?? {}) as Record<string, string>).map(
              ([k, v]) => [k, v] as [string, string]
            ),
            ...Object.entries(item.customSelections ?? {}).flatMap(([name, vals]) =>
              vals.map((v) => [name, v] as [string, string])
            )
          ]
          if (optEntries.length > 0) {
            const opts = await tx
              .select()
              .from(productOptions)
              .where(
                and(
                  eq(productOptions.productId, item.productId),
                  eq(productOptions.merchantId, store.merchant.id)
                )
              )
            for (const o of opts) {
              const ctl = o.allowControl as { perValueQuantity?: boolean } | null
              if (!ctl?.perValueQuantity) continue
              const wanted = new Set(
                optEntries
                  .filter(([k]) => k === o.id || k === o.name)
                  .map(([, v]) => v)
              )
              if (wanted.size === 0) continue
              const vals = await tx
                .select()
                .from(productOptionValues)
                .where(
                  and(
                    eq(productOptionValues.optionId, o.id),
                    eq(productOptionValues.merchantId, store.merchant.id)
                  )
                )
              for (const v of vals) {
                if (!wanted.has(v.value)) continue
                if (v.quantity === null) continue
                const vAfter = v.quantity - item.quantity
                if (vAfter < 0)
                  throw badRequest('OUT_OF_STOCK', `Not enough stock for ${o.name}: ${v.value}`)
                await tx
                  .update(productOptionValues)
                  .set({ quantity: vAfter })
                  .where(eq(productOptionValues.id, v.id))
              }
            }
          }

          // Fulfillment allocation: decrement the chosen warehouse's stock for
          // this variant so per-location availability reflects the sale. Skips
          // variants the warehouse doesn't stock (no row → never below 0).
          if (fulfillingWarehouseId) {
            await allocateWarehouseStock(
              tx,
              store.merchant.id,
              fulfillingWarehouseId,
              item.variantId,
              item.quantity
            )
          }
        }
      }

      return order
    })

    // Post-commit growth hooks. They run inside the request (on the still-open
    // tenant connection) and never fail a paid checkout: any error is logged
    // for the operator while the durable order stands.
    const referralCode = body.referralCode?.trim()
    if (referralCode) {
      try {
        await attributeOrder(db, store.merchant.id, {
          orderId: placedOrder.id,
          customerId: placedOrder.customerId,
          subtotal: Number(placedOrder.subtotal),
          referralCode
        })
      } catch (err) {
        log.warn('affiliate attribution failed', err)
      }
    }
    if (placedOrder.customerId) {
      try {
        await awardForOrder(db, store.merchant.id, {
          customerId: placedOrder.customerId,
          orderId: placedOrder.id,
          subtotal: Number(placedOrder.subtotal)
        })
      } catch (err) {
        log.warn('loyalty award failed', err)
      }
    }
    return placedOrder
  }

  /** Shared confirmation shape returned by the idempotent checkout replay. */
  private static confirmationFor(order: typeof orders.$inferSelect) {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      total: number(order.total),
      currency: order.currency
    }
  }

  /** Find an order for this merchant+key (idempotent replay path). */
  private static async findByIdempotencyKey(db: DB, merchantId: string, key: string) {
    const [existing] = await db
      .select()
      .from(orders)
      .where(
        and(eq(orders.merchantId, merchantId), eq(orders.idempotencyKey, key))
      )
    return existing ?? null
  }

  static async checkout(db: DB, slug: string, body: CheckoutInput) {
    const store = await this.resolveStore(db, slug)
    const kind = await this.assertPaymentMethodAvailable(db, store.merchant.id, body.paymentMethod)
    if (kind.kind === 'provider') {
      throw badRequest(
        'PAYMENT_REQUIRES_REDIRECT',
        `"${body.paymentMethod}" requires an online payment session — use /checkout/pay`
      )
    }

    let summary: Awaited<ReturnType<typeof this.buildSummary>>
    if (body.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(db, store.merchant.id, body.idempotencyKey)
      if (existing) {
        return ok({
          ...this.confirmationFor(existing),
          email: body.email.trim().toLowerCase(),
          createdAt: existing.createdAt
        })
      }
      summary = await this.buildSummary(db, slug, body)
      this.assertShippingSupported(summary.store, body.shippingAddress?.country as string | undefined)
      this.validateRequiredFields(summary.store, body.shippingAddress)

      await this.assertCodAvailable(
        db,
        summary.store.merchant.id,
        body.paymentMethod,
        summary.total,
        body.shippingAddress
      )

      // Legacy "card" demo method is treated as paid-on-place; everything else waits for payment.
      const paymentStatus = body.paymentMethod === 'card' ? 'paid' : 'unpaid'
      let result
      try {
        result = await this.createOrderTx(db, summary.store, body, {
          items: summary.items,
          subtotal: summary.subtotal,
          discountTotal: summary.discountTotal,
          shipping: summary.shipping,
          taxTotal: summary.taxTotal,
          total: summary.total,
          coupon: summary.coupon,
          promotionId: summary.promotion?.id ?? null
        }, { paymentStatus })
      } catch (err) {
        // Concurrent duplicate raced past the pre-check — the unique
        // (merchant_id, idempotency_key) index wins; return the winner.
        if (body.idempotencyKey && (err as { code?: string }).code === '23505') {
          const existing = await this.findByIdempotencyKey(db, store.merchant.id, body.idempotencyKey)
          if (existing) {
            return ok({
              ...this.confirmationFor(existing),
              email: body.email.trim().toLowerCase(),
              createdAt: existing.createdAt
            })
          }
        }
        throw err
      }

      // Fire-and-forget follow-ups run on the platform admin connection — the
      // request-scoped tenant connection is closed once this handler returns.
      void EmailsService.orderPlaced(platformDb, result)
      emit(summary.store.merchant.id, 'order.created', {
        orderId: result.id,
        orderNumber: result.orderNumber,
        status: result.status,
        paymentStatus: result.paymentStatus
      })

      // Convert the tracked shopping cart (if the shopper had one) into an order.
      if (body.cartId) {
        void CartsService.markConverted(platformDb, summary.store.merchant.id, body.cartId, result.id)
      }

      return ok({
        ...this.confirmationFor(result),
        email: body.email.trim().toLowerCase(),
        createdAt: result.createdAt
      })
    }

    summary = await this.buildSummary(db, slug, body)
    this.assertShippingSupported(summary.store, body.shippingAddress?.country as string | undefined)
    this.validateRequiredFields(summary.store, body.shippingAddress)

    await this.assertCodAvailable(
      db,
      summary.store.merchant.id,
      body.paymentMethod,
      summary.total,
      body.shippingAddress
    )

    // Legacy "card" demo method is treated as paid-on-place; everything else waits for payment.
    const paymentStatus = body.paymentMethod === 'card' ? 'paid' : 'unpaid'
    const result = await this.createOrderTx(db, summary.store, body, {
      items: summary.items,
      subtotal: summary.subtotal,
      discountTotal: summary.discountTotal,
      shipping: summary.shipping,
      taxTotal: summary.taxTotal,
      total: summary.total,
      coupon: summary.coupon,
      promotionId: summary.promotion?.id ?? null
    }, { paymentStatus })

    // Fire-and-forget follow-ups run on the platform admin connection — the
    // request-scoped tenant connection is closed once this handler returns.
    void EmailsService.orderPlaced(platformDb, result)
    emit(summary.store.merchant.id, 'order.created', {
      orderId: result.id,
      orderNumber: result.orderNumber,
      status: result.status,
      paymentStatus: result.paymentStatus
    })

    // Convert the tracked shopping cart (if the shopper had one) into an order.
    if (body.cartId) {
      void CartsService.markConverted(platformDb, summary.store.merchant.id, body.cartId, result.id)
    }

    return ok({
      ...this.confirmationFor(result),
      email: body.email.trim().toLowerCase(),
      createdAt: result.createdAt
    })
  }

  static async createProviderCheckout(db: DB, slug: string, body: CheckoutInput) {
    const store = await this.resolveStore(db, slug)
    const providerId = body.paymentMethod

    // Idempotent replay: the same logical checkout retried (gateway timeout /
    // network error) returns the stored order instead of creating a duplicate
    // order + session. No redirect URL is re-issued — the shopper lands on the
    // confirmation page and re-verifies with the provider.
    if (body.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(db, store.merchant.id, body.idempotencyKey)
      if (existing) {
        return ok({
          id: existing.id,
          orderNumber: existing.orderNumber,
          requiresRedirect: false,
          provider: existing.paymentProvider ?? providerId,
          redirectUrl: '',
          total: number(existing.total),
          currency: existing.currency
        })
      }
    }

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

    const summary = await this.buildSummary(db, slug, body)
    this.assertShippingSupported(summary.store, body.shippingAddress?.country as string | undefined)
    this.validateRequiredFields(summary.store, body.shippingAddress)

    let order: typeof orders.$inferSelect
    try {
      order = await this.createOrderTx(db, store, body, {
        items: summary.items,
        subtotal: summary.subtotal,
        discountTotal: summary.discountTotal,
        shipping: summary.shipping,
        taxTotal: summary.taxTotal,
        total: summary.total,
        coupon: summary.coupon,
        promotionId: summary.promotion?.id ?? null
      }, {
        paymentStatus: 'unpaid',
        provider: providerId,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000)
      })
    } catch (err) {
      // Concurrent duplicate raced past the pre-check — hand back the winner.
      if (body.idempotencyKey && (err as { code?: string }).code === '23505') {
        const existing = await this.findByIdempotencyKey(db, store.merchant.id, body.idempotencyKey)
        if (existing) {
          return ok({
            id: existing.id,
            orderNumber: existing.orderNumber,
            requiresRedirect: false,
            provider: existing.paymentProvider ?? providerId,
            redirectUrl: '',
            total: number(existing.total),
            currency: existing.currency
          })
        }
      }
      throw err
    }

    // Fire-and-forget follow-ups run on the platform admin connection — the
    // request-scoped tenant connection is closed once this handler returns.
    void EmailsService.orderPlaced(platformDb, order)
    emit(store.merchant.id, 'order.created', {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus
    })

    // Convert the tracked shopping cart (if the shopper had one) into an order.
    if (body.cartId) {
      void CartsService.markConverted(platformDb, store.merchant.id, body.cartId, order.id)
    }

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
        shippingAddress: body.shippingAddress as Record<string, unknown>,
        ...urls
      })
    } catch (err) {
      // Session failed → cancel immediately and release the held stock instead of
      // waiting for the expiry sweep (the customer never reached the gateway).
      log.error(`${providerId} createSession failed for ${order.orderNumber}`, err)
      await this.cancelPendingOrder(db, order)
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

  /** Cancel a pending unpaid provider order — delegates to the authoritative
   *  shared cancellation (claim + restock + coupon restore).
   *  `db` is the tenant connection when called from a tenant route, the admin
   *  connection when called from the platform-wide sweep.
   *  Returns false when another path (webhook, sweep, sync) already resolved the order. */
  private static async cancelPendingOrder(db: DB, order: typeof orders.$inferSelect): Promise<boolean> {
    return runCancelPendingOrder(db, order)
  }

  /** Server-side re-verification used by the storefront return page. */
  static async syncOrder(db: DB, slug: string, orderNumber: string, payload?: { paymentId?: string }) {
    const store = await this.resolveStore(db, slug)
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

    const applied = await OrdersService.applyPaymentResult(db, store.merchant.id, order.paymentProvider, result)
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
        const done = await this.cancelPendingOrder(db, order)
        if (done) cancelled++
      } catch (err) {
        log.error(`failed to expire order ${order.orderNumber}`, err)
      }
    }
    return cancelled
  }

  static async order(db: DB, slug: string, orderNumber: string) {
    const store = await this.resolveStore(db, slug)
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
      // renders shipping info plus the customer's OWN checkout note (there are
      // no merchant-internal notes in the schema). Order numbers are
      // CSPRNG-suffixed and the lookup route is rate-limited.
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
