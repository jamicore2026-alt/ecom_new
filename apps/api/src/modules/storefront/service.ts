import { and, asc, count, desc, eq, gte, ilike, inArray, lte, ne, or } from 'drizzle-orm'
import { db } from '../../database/client'
import {
  categories,
  merchants,
  paymentSettings,
  products,
  productVariants,
  shippingSettings,
  storeSettings,
  taxSettings
} from '../../database/schema'
import { makeMeta, parsePagination } from '../../shared/pagination'
import { ok } from '../../shared/response'
import { notFound } from '../../shared/errors'

const number = (v: unknown) => Number(v)

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
}
