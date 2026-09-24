import { and, asc, count, desc, eq, gte, ilike, inArray, lte, sql } from 'drizzle-orm'
import type { DB } from '../../database/client'
import {
  categories,
  inventoryLogs,
  productImages,
  productOptions,
  productOptionValues,
  products,
  productVariants
} from '../../database/schema'
import { makeMeta, parsePagination } from '../../shared/pagination'
import { productSearchCondition } from '../../shared/product-search'
import { setVariantInventoryTx } from '../../shared/inventory'
import { emit } from '../../shared/event-dispatch'
import { parseCsv, toCsv } from '../../shared/csv'
import { ok } from '../../shared/response'
import { badRequest, notFound } from '../../shared/errors'
import type { NewProduct, NewProductVariant } from '../../database/schema'
import type { OptionType } from '../../shared/types'

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'product'

interface ProductQuery {
  page?: string
  limit?: string
  search?: string
  status?: string
  categoryId?: string
  minPrice?: string
  maxPrice?: string
  lowStock?: string
}

const toDate = (v?: string | Date | null) => {
  if (v === undefined || v === null || v === '') return null
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) throw badRequest('BAD_REQUEST', `Invalid date: ${v}`)
  return d
}

type SalePriced = {
  price: number | string | null | undefined
  compareAtPrice?: number | string | null | undefined
  saleStartsAt?: Date | string | null | undefined
  saleEndsAt?: Date | string | null | undefined
}

/**
 * Effective sale logic (documented for the storefront caller — admin
 * list/detail intentionally return STORED values, never the computed price):
 * the sale price (`price`) applies only inside [saleStartsAt, saleEndsAt]
 * (null bounds = open-ended). Outside the window the price reverts to
 * `compareAtPrice ?? price`. Rows without a compareAtPrice have no sale, so
 * the stored price always applies.
 *
 * NOTE: storefront/service.ts pricing internals are out of scope — the
 * storefront must call this helper (imported from the products module) when
 * resolving display prices instead of reimplementing the window check.
 */
export function effectivePrice<T extends SalePriced>(item: T, now: Date = new Date()): number {
  const price = Number(item.price ?? 0)
  const compareAt =
    item.compareAtPrice === null || item.compareAtPrice === undefined || item.compareAtPrice === ''
      ? null
      : Number(item.compareAtPrice)
  if (compareAt === null || Number.isNaN(compareAt)) return price
  const start = item.saleStartsAt ? new Date(item.saleStartsAt as string) : null
  const end = item.saleEndsAt ? new Date(item.saleEndsAt as string) : null
  if (start && !Number.isNaN(start.getTime()) && now < start) return compareAt
  if (end && !Number.isNaN(end.getTime()) && now > end) return compareAt
  return price
}

/**
 * Scheduled-publishing gate for a FUTURE storefront caller (not enforced
 * here — admin CRUD only stores the value). Returns true when the product
 * may be shown on the storefront at `now`: status must be 'active' and
 * publishAt must be null or in the past.
 */
export function isPublished(
  product: { status?: string | null; publishAt?: Date | string | null },
  now: Date = new Date()
): boolean {
  if (product.status && product.status !== 'active') return false
  if (!product.publishAt) return true
  const at = new Date(product.publishAt as string)
  if (Number.isNaN(at.getTime())) return true
  return now >= at
}

/**
 * Promo-integrity guard: a compare-at ("was") price is only meaningful above
 * the sale price. Rejects fake sales instead of silently storing them.
 */
function assertValidSalePrice(price: number | null | undefined, compareAtPrice: number | null | undefined) {
  if (
    compareAtPrice !== null &&
    compareAtPrice !== undefined &&
    price !== null &&
    price !== undefined &&
    compareAtPrice <= price
  ) {
    throw badRequest('INVALID_SALE_PRICE', 'Compare-at price must be higher than the sale price')
  }
}

export class ProductsService {
  /* ------------------------------- helpers ------------------------------- */

  private static async uniqueSlug(db: DB, merchantId: string, base: string) {
    const slug = slugify(base)
    const existing = await db
      .select({ slug: products.slug })
      .from(products)
      .where(and(eq(products.merchantId, merchantId), ilike(products.slug, `${slug}%`)))
    if (!existing.some((e) => e.slug === slug)) return slug
    let i = 2
    while (existing.some((e) => e.slug === `${slug}-${i}`)) i++
    return `${slug}-${i}`
  }

  private static async categoryMap(db: DB, ids: string[]) {
    if (!ids.length) return new Map<string, typeof categories.$inferSelect>()
    const rows = await db.select().from(categories).where(inArray(categories.id, ids))
    return new Map(rows.map((c) => [c.id, c]))
  }

  /** Replace the full image set of a product. Array order defines sortOrder when omitted. */
  private static async syncImages(
    executor: any,
    productId: string,
    inputs: Array<{ url: string; altText?: string; sortOrder?: number }>
  ) {
    await executor.delete(productImages).where(eq(productImages.productId, productId))
    if (!inputs.length) return []
    return executor
      .insert(productImages)
      .values(
        inputs.map((img, index) => ({
          productId,
          url: img.url,
          altText: img.altText ?? null,
          sortOrder: img.sortOrder ?? index
        }))
      )
      .returning()
  }

  private static async imagesFor(db: DB, ids: string[]) {
    if (!ids.length) return new Map<string, typeof productImages.$inferSelect[]>()
    const rows = await db
      .select()
      .from(productImages)
      .where(inArray(productImages.productId, ids))
      .orderBy(asc(productImages.sortOrder), asc(productImages.createdAt))
    const map = new Map<string, typeof productImages.$inferSelect[]>()
    for (const row of rows) {
      map.set(row.productId, [...(map.get(row.productId) ?? []), row])
    }
    return map
  }

  private static async enrich(db: DB, rows: typeof products.$inferSelect[]) {
    if (!rows.length) return []
    const ids = rows.map((r) => r.id)
    const agg = await db
      .select({
        productId: productVariants.productId,
        stock: sql<number>`coalesce(sum(${productVariants.inventory}), 0)`,
        variantCount: count()
      })
      .from(productVariants)
      .where(inArray(productVariants.productId, ids))
      .groupBy(productVariants.productId)
    const aggMap = new Map(agg.map((a) => [a.productId, a]))
    const catMap = await this.categoryMap(
      db,
      [...new Set(rows.map((r) => r.categoryId).filter((v): v is string => !!v))]
    )
    const imageMap = await this.imagesFor(db, ids)
    return rows.map((p) => ({
      ...p,
      stock: Number(aggMap.get(p.id)?.stock ?? 0),
      variantCount: Number(aggMap.get(p.id)?.variantCount ?? 0),
      category: p.categoryId ? (catMap.get(p.categoryId) ?? null) : null,
      images: imageMap.get(p.id) ?? [],
      primaryImage: imageMap.get(p.id)?.[0]?.url ?? null
    }))
  }

  /* -------------------------------- products ------------------------------ */

  static async list(db: DB, merchantId: string, q: ProductQuery) {
    const { page, limit, offset } = parsePagination(q)
    const conditions = [eq(products.merchantId, merchantId)]

    const search = q.search?.trim()
    if (search) {
      const cond = productSearchCondition(search)
      if (cond) conditions.push(cond)
    }
    if (q.status) conditions.push(eq(products.status, q.status))
    if (q.categoryId) conditions.push(eq(products.categoryId, q.categoryId))
    if (q.minPrice !== undefined && q.minPrice !== '') conditions.push(gte(products.price, Number(q.minPrice)))
    if (q.maxPrice !== undefined && q.maxPrice !== '') conditions.push(lte(products.price, Number(q.maxPrice)))
    if (q.lowStock === 'true' || q.lowStock === '1') {
      const low = await db
        .selectDistinct({ id: productVariants.productId })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(
          and(
            eq(products.merchantId, merchantId),
            sql`${productVariants.inventory} <= ${products.lowStockThreshold}`
          )
        )
      conditions.push(inArray(products.id, low.map((r) => r.id)))
    }

    const where = and(...conditions)
    const [{ total }] = await db.select({ total: count() }).from(products).where(where)
    const rows = await db
      .select()
      .from(products)
      .where(where)
      .orderBy(desc(products.createdAt))
      .limit(limit)
      .offset(offset)

    return ok({ items: await this.enrich(db, rows), meta: makeMeta(page, limit, Number(total)) })
  }

  static async get(db: DB, merchantId: string, id: string) {
    const [product] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.merchantId, merchantId)))
    if (!product) throw notFound('NOT_FOUND', 'Product not found')

    const variants = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, id))

    const images = await db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, id))
      .orderBy(asc(productImages.sortOrder), asc(productImages.createdAt))

    const [category] = product.categoryId
      ? await db.select().from(categories).where(eq(categories.id, product.categoryId))
      : []

    const stock = variants.reduce((sum, v) => sum + v.inventory, 0)
    const { data } = await this.listOptions(db, merchantId, id)
    return ok({
      ...product,
      variants,
      options: data.items,
      category: category ?? null,
      stock,
      images,
      primaryImage: images[0]?.url ?? null
    })
  }

  static async create(
    db: DB,
    merchantId: string,
    input: {
      name: string
      nameAr?: string
      sku?: string
      barcode?: string
      slug?: string
      description?: string
      descriptionAr?: string
      price: number
      compareAtPrice?: number | null
      cost?: number
      categoryId?: string | null
      trackInventory?: boolean
      lowStockThreshold?: number
      status?: string
      visibility?: string
      tags?: string[]
      weight?: number | null
      gtin?: string | null
      metaTitle?: string | null
      metaDescription?: string | null
      saleStartsAt?: string | Date | null
      saleEndsAt?: string | Date | null
      publishAt?: string | Date | null
      variants?: Array<{
        sku?: string
        optionValues?: Record<string, string>
        optionValuesAr?: Record<string, string>
        price?: number
        compareAtPrice?: number
        inventory?: number
        unlimited?: boolean
        image?: string
      }>
      images?: Array<{ url: string; altText?: string; sortOrder?: number }>
    }
  ) {
    if (input.variants?.some((v) => (v.inventory ?? 0) < 0)) {
      throw badRequest('BAD_REQUEST', 'Variant inventory cannot be negative')
    }
    assertValidSalePrice(input.price, input.compareAtPrice)
    for (const v of input.variants ?? []) {
      assertValidSalePrice(v.price ?? input.price, v.compareAtPrice)
    }
    if (input.categoryId) {
      const [cat] = await db
        .select()
        .from(categories)
        .where(and(eq(categories.id, input.categoryId), eq(categories.merchantId, merchantId)))
      if (!cat) throw badRequest('BAD_REQUEST', 'Category does not exist')
    }

    const slug = await this.uniqueSlug(db, merchantId, input.slug ?? input.name)
    const result = await db.transaction(async (tx) => {
      const [product] = await tx
        .insert(products)
        .values({
          merchantId,
          name: input.name,
          nameAr: input.nameAr ?? null,
          slug,
          sku: input.sku ?? null,
          barcode: input.barcode ?? null,
          description: input.description ?? '',
          descriptionAr: input.descriptionAr ?? '',
          price: input.price,
          compareAtPrice: input.compareAtPrice ?? null,
          cost: input.cost ?? 0,
          categoryId: input.categoryId ?? null,
          trackInventory: input.trackInventory ?? false,
          lowStockThreshold: input.lowStockThreshold ?? 5,
          status: input.status ?? 'active',
          visibility: (input.visibility ?? 'both') as 'both' | 'pos' | 'website',
          tags: input.tags ?? [],
          weight: input.weight ?? null,
          gtin: input.gtin || null,
          metaTitle: input.metaTitle || null,
          metaDescription: input.metaDescription || null,
          saleStartsAt: toDate(input.saleStartsAt),
          saleEndsAt: toDate(input.saleEndsAt),
          publishAt: toDate(input.publishAt)
        })
        .returning()

      const variantInputs = input.variants?.length
        ? input.variants
        : [{ sku: input.sku, price: input.price }]
      const variants = await this.insertVariants(tx, product.id, variantInputs, input.price)
      const images = input.images?.length
        ? await this.syncImages(tx, product.id, input.images)
        : []
      return { product, variants, images }
    })

    const stock = result.variants.reduce((s: number, v: { inventory: number }) => s + v.inventory, 0)
    emit(merchantId, 'product.created', { productId: result.product.id, name: result.product.name })
    return ok({
      ...result.product,
      variants: result.variants,
      category: null,
      stock,
      images: result.images,
      primaryImage: result.images[0]?.url ?? null
    })
  }

  private static async insertVariants(
    executor: any,
    productId: string,
    inputs: Array<{
      sku?: string
      optionValues?: Record<string, string>
      optionValuesAr?: Record<string, string>
      price?: number
      compareAtPrice?: number
      inventory?: number
      unlimited?: boolean
      image?: string
    }>,
    defaultPrice: number
  ) {
    const values: NewProductVariant[] = inputs.map((v) => ({
      productId,
      sku: v.sku ?? null,
      optionValues: v.optionValues ?? {},
      optionValuesAr: v.optionValuesAr ?? {},
      price: v.price ?? defaultPrice,
      compareAtPrice: v.compareAtPrice ?? null,
      inventory: v.inventory ?? 0,
      unlimited: v.unlimited ?? false,
      image: v.image ?? null
    }))
    return executor.insert(productVariants).values(values).returning()
  }

  static async update(
    db: DB,
    merchantId: string,
    id: string,
    input: Record<string, unknown>
  ) {
    const [product] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.merchantId, merchantId)))
    if (!product) throw notFound('NOT_FOUND', 'Product not found')

    assertValidSalePrice(
      (input.price as number | undefined) ?? product.price,
      input.compareAtPrice !== undefined ? (input.compareAtPrice as number | null) : product.compareAtPrice
    )

    if (input.categoryId) {
      const [cat] = await db
        .select()
        .from(categories)
        .where(and(eq(categories.id, input.categoryId as string), eq(categories.merchantId, merchantId)))
      if (!cat) throw badRequest('BAD_REQUEST', 'Category does not exist')
    }

    const slug = input.slug
      ? await this.uniqueSlug(db, merchantId, input.slug as string)
      : undefined

    const values: Partial<NewProduct> = {}
    for (const key of [
      'name',
      'nameAr',
      'sku',
      'barcode',
      'description',
      'descriptionAr',
      'price',
      'compareAtPrice',
      'cost',
      'categoryId',
      'trackInventory',
      'lowStockThreshold',
      'status',
      'visibility',
      'tags',
      'weight',
      'gtin',
      'metaTitle',
      'metaDescription'
    ] as const) {
      if (input[key] !== undefined) values[key] = input[key] as never
    }
    for (const key of ['saleStartsAt', 'saleEndsAt', 'publishAt'] as const) {
      if (input[key] !== undefined) values[key] = toDate(input[key] as string | null) as never
    }
    if (slug) values.slug = slug

    if (Object.keys(values).length === 0 && input.images === undefined) {
      const variants = await db
        .select()
        .from(productVariants)
        .where(eq(productVariants.productId, id))
      const images = await db
        .select()
        .from(productImages)
        .where(eq(productImages.productId, id))
        .orderBy(asc(productImages.sortOrder), asc(productImages.createdAt))
      return ok({ ...product, variants, category: null, images })
    }

    const [updated] = await db.transaction(async (tx) => {
      let row = product
      if (Object.keys(values).length > 0) {
        const [u] = await tx
          .update(products)
          .set(values)
          .where(and(eq(products.id, id), eq(products.merchantId, merchantId)))
          .returning()
        row = u
      }
      const images =
        input.images !== undefined
          ? await this.syncImages(
              tx,
              id,
              input.images as Array<{ url: string; altText?: string; sortOrder?: number }>
            )
          : await tx
              .select()
              .from(productImages)
              .where(eq(productImages.productId, id))
              .orderBy(asc(productImages.sortOrder), asc(productImages.createdAt))
      return [{ ...row, images }]
    })

    const variants = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, id))

    emit(merchantId, 'product.updated', { productId: id, name: updated.name })
    return ok({
      ...updated,
      variants,
      category: null,
      primaryImage: updated.images[0]?.url ?? null
    })
  }

  static async archive(db: DB, merchantId: string, id: string) {
    const [product] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.merchantId, merchantId)))
    if (!product) throw notFound('NOT_FOUND', 'Product not found')

    const [updated] = await db
      .update(products)
      .set({ status: 'archived' })
      .where(and(eq(products.id, id), eq(products.merchantId, merchantId)))
      .returning()

    emit(merchantId, 'product.archived', { productId: id, name: updated.name })
    return ok(updated)
  }

  static async bulkEdit(
    db: DB,
    merchantId: string,
    input: { ids: string[]; action: string; value: string | number | null }
  ) {
    const ids = [...new Set(input.ids)]
    const [ownership] = await db
      .select({ count: count() })
      .from(products)
      .where(and(eq(products.merchantId, merchantId), inArray(products.id, ids)))
    if (Number(ownership?.count ?? 0) !== ids.length) {
      throw badRequest('BAD_REQUEST', 'One or more products do not belong to this store')
    }

    const where = and(eq(products.merchantId, merchantId), inArray(products.id, ids))

    switch (input.action) {
      case 'set_status': {
        const statusVal = input.value as string
        if (!['active', 'draft', 'archived'].includes(statusVal)) {
          throw badRequest('BAD_REQUEST', 'Invalid product status')
        }
        await db.update(products).set({ status: statusVal }).where(where)
        break
      }
      case 'set_category': {
        const categoryId = (input.value as string) || null
        if (categoryId) {
          const [cat] = await db
            .select()
            .from(categories)
            .where(and(eq(categories.id, categoryId), eq(categories.merchantId, merchantId)))
          if (!cat) throw badRequest('BAD_REQUEST', 'Category does not exist')
        }
        await db.update(products).set({ categoryId }).where(where)
        break
      }
      case 'multiply_price': {
        const multiplier = Number(input.value)
        if (!Number.isFinite(multiplier) || multiplier <= 0) {
          throw badRequest('BAD_REQUEST', 'Price multiplier must be a positive number')
        }
        await db
          .update(products)
          .set({ price: sql`round((${products.price} * ${multiplier})::numeric, 3)` })
          .where(where)
        break
      }
      case 'set_inventory': {
        const value = Math.max(0, Math.floor(Number(input.value) || 0))
        await db.transaction(async (tx) => {
          // Locked read inside the tx — a concurrent sale between read and
          // write would otherwise be silently overwritten (P1-05).
          const variants = await tx
            .select()
            .from(productVariants)
            .where(inArray(productVariants.productId, ids))
            .for('update')
          for (const v of variants) {
            await setVariantInventoryTx(tx, merchantId, v.id, value, {
              reason: 'adjustment',
              reference: 'bulk-edit'
            })
          }
        })
        break
      }
      case 'set_visibility': {
        const vis = input.value as string
        if (!['both', 'pos', 'website'].includes(vis)) {
          throw badRequest('BAD_REQUEST', 'Invalid visibility (both | pos | website)')
        }
        await db.update(products).set({ visibility: vis as 'both' | 'pos' | 'website' }).where(where)
        break
      }
      case 'set_compare_at': {
        const raw = input.value
        const num = raw === null || raw === '' ? null : Number(raw)
        if (num !== null && (!Number.isFinite(num) || num < 0)) {
          throw badRequest('BAD_REQUEST', 'Compare-at price must be a non-negative number or null')
        }
        await db.update(products).set({ compareAtPrice: num }).where(where)
        break
      }
      case 'clear_sale': {
        await db
          .update(products)
          .set({ compareAtPrice: null, saleStartsAt: null, saleEndsAt: null })
          .where(where)
        break
      }
      default:
        throw badRequest('BAD_REQUEST', 'Unknown bulk action')
    }

    return ok({ updated: ids.length })
  }

  /* ------------------------------- categories ------------------------------ */

  static async listCategories(db: DB, merchantId: string) {
    const rows = await db
      .select()
      .from(categories)
      .where(eq(categories.merchantId, merchantId))
      .orderBy(asc(categories.sortOrder), asc(categories.name))

    const children = new Map<string, typeof rows[number][]>()
    const roots: typeof rows = []
    for (const cat of rows) {
      if (cat.parentId) {
        children.set(cat.parentId, [...(children.get(cat.parentId) ?? []), cat])
      } else {
        roots.push(cat)
      }
    }
    // Cycle-safe build: track visited ids to prevent infinite recursion
    const build = (cat: typeof rows[number], visited = new Set<string>()): unknown => {
      if (visited.has(cat.id)) return { ...cat, children: [] }
      const next = new Set(visited).add(cat.id)
      return {
        ...cat,
        children: (children.get(cat.id) ?? []).map((c) => build(c, next))
      }
    }
    return ok({ items: roots.map((r) => build(r)) })
  }

  static async createCategory(
    db: DB,
    merchantId: string,
    input: { name: string; nameAr?: string; slug?: string; parentId?: string | null; image?: string | null; description?: string | null; sortOrder?: number; status?: string }
  ) {
    if (input.parentId) {
      await this.assertCategoryParent(db, merchantId, input.parentId)
    }
    const slug = await this.uniqueCategorySlug(db, merchantId, input.slug ?? input.name)
    const [created] = await db
      .insert(categories)
      .values({
        merchantId,
        name: input.name,
        nameAr: input.nameAr ?? null,
        slug,
        parentId: input.parentId ?? null,
        image: input.image ?? null,
        description: input.description ?? null,
        sortOrder: input.sortOrder ?? 0,
        status: input.status ?? 'active'
      })
      .returning()
    return ok(created)
  }

  private static async uniqueCategorySlug(db: DB, merchantId: string, base: string) {
    const slug = slugify(base)
    const existing = await db
      .select({ slug: categories.slug })
      .from(categories)
      .where(and(eq(categories.merchantId, merchantId), ilike(categories.slug, `${slug}%`)))
    if (!existing.some((e) => e.slug === slug)) return slug
    let i = 2
    while (existing.some((e) => e.slug === `${slug}-${i}`)) i++
    return `${slug}-${i}`
  }

  static async updateCategory(
    db: DB,
    merchantId: string,
    id: string,
    input: { name?: string; nameAr?: string | null; slug?: string; parentId?: string | null; image?: string | null; description?: string | null; sortOrder?: number; status?: string }
  ) {
    const [cat] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.merchantId, merchantId)))
    if (!cat) throw notFound('NOT_FOUND', 'Category not found')

    if (input.parentId !== undefined) {
      const newParent = input.parentId
      if (newParent && newParent !== cat.id) {
        await this.assertCategoryParent(db, merchantId, newParent, cat.id)
      } else if (newParent === cat.id) {
        throw badRequest('BAD_REQUEST', 'A category cannot be its own parent')
      }
    }

    const values: Record<string, unknown> = {}
    if (input.name !== undefined) values.name = input.name
    if (input.nameAr !== undefined) values.nameAr = input.nameAr ?? null
    if (input.image !== undefined) values.image = input.image ?? null
    if (input.description !== undefined) values.description = input.description ?? null
    if (input.sortOrder !== undefined) values.sortOrder = input.sortOrder
    if (input.status !== undefined) values.status = input.status
    if (input.parentId !== undefined) values.parentId = input.parentId ?? null
    if (input.slug) values.slug = await this.uniqueCategorySlug(db, merchantId, input.slug)

    if (Object.keys(values).length === 0) return ok(cat)

    const [updated] = await db
      .update(categories)
      .set(values)
      .where(and(eq(categories.id, id), eq(categories.merchantId, merchantId)))
      .returning()
    return ok(updated)
  }

  /** Ensure a proposed parent belongs to this merchant and is not a descendant of the category. */
  private static async assertCategoryParent(
    db: DB,
    merchantId: string,
    parentId: string,
    excludeId?: string
  ) {
    const [parent] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, parentId), eq(categories.merchantId, merchantId)))
    if (!parent) throw badRequest('BAD_REQUEST', 'Parent category does not exist')

    if (excludeId) {
      // Walk up the parent chain; if we ever reach excludeId, a cycle would form
      let current: string | null = parentId
      const seen = new Set<string>()
      while (current) {
        if (current === excludeId) {
          throw badRequest('BAD_REQUEST', 'Cannot set a descendant as the parent (cycle)')
        }
        if (seen.has(current)) break
        seen.add(current)
        const [row] = await db
          .select({ parentId: categories.parentId })
          .from(categories)
          .where(eq(categories.id, current))
        current = row?.parentId ?? null
      }
    }
  }

  static async deleteCategory(db: DB, merchantId: string, id: string, reassignTo?: string | null) {
    const [cat] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.merchantId, merchantId)))
    if (!cat) throw notFound('NOT_FOUND', 'Category not found')

    let targetId: string | null = null
    if (reassignTo) {
      if (reassignTo === id) throw badRequest('BAD_REQUEST', 'Cannot reassign products to the deleted category')
      const [target] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, reassignTo), eq(categories.merchantId, merchantId)))
      if (!target) throw badRequest('BAD_REQUEST', 'Reassign target category does not exist')
      targetId = target.id
    }

    await db.transaction(async (tx) => {
      await tx.update(products).set({ categoryId: targetId }).where(eq(products.categoryId, id))
      await tx.delete(categories).where(eq(categories.id, id))
    })
    return ok({ deleted: true, reassignedTo: targetId })
  }

  /* -------------------------------- variants ------------------------------ */

  private static async findProduct(db: DB, merchantId: string, productId: string) {
    const [p] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.merchantId, merchantId)))
    return p
  }

  private static async findVariant(db: DB, merchantId: string, variantId: string) {
    const [v] = await db
      .select({ variant: productVariants, product: products })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(and(eq(productVariants.id, variantId), eq(products.merchantId, merchantId)))
    return v
  }

  static async listVariants(db: DB, merchantId: string, productId: string) {
    const product = await this.findProduct(db, merchantId, productId)
    if (!product) throw notFound('NOT_FOUND', 'Product not found')
    const rows = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productId))
    return ok(rows)
  }

  /* ----------------------------- options ------------------------------- */

  /** Option definitions for a product, each with its values. */
  static async listOptions(db: DB, merchantId: string, productId: string) {
    const product = await this.findProduct(db, merchantId, productId)
    if (!product) throw notFound('NOT_FOUND', 'Product not found')
    const opts = await db
      .select()
      .from(productOptions)
      .where(eq(productOptions.productId, productId))
      .orderBy(asc(productOptions.sortOrder), asc(productOptions.createdAt))
    if (!opts.length) return ok({ items: [] })
    const values = await db
      .select()
      .from(productOptionValues)
      .where(inArray(productOptionValues.optionId, opts.map((o) => o.id)))
      .orderBy(asc(productOptionValues.sortOrder), asc(productOptionValues.createdAt))
    return ok({
      items: opts.map((o) => ({
        ...o,
        values: values.filter((v) => v.optionId === o.id)
      }))
    })
  }

  /** Replace the full option set (and their values) of a product atomically. */
  static async saveOptions(
    db: DB,
    merchantId: string,
    productId: string,
    input: Array<{
      name: string
      nameAr?: string
      type?: OptionType
      required?: boolean
      minSelections?: number
      maxSelections?: number
      perValueQuantity?: boolean
      unlimited?: boolean
      sortOrder?: number
      status?: string
      values?: Array<{
        value: string
        valueAr?: string
        priceAdjustment?: number
        quantity?: number
        meta?: Record<string, string>
        sortOrder?: number
        status?: string
      }>
    }>
  ) {
    const product = await this.findProduct(db, merchantId, productId)
    if (!product) throw notFound('NOT_FOUND', 'Product not found')
    const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

    await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(productOptions)
        .where(eq(productOptions.productId, productId))
      if (existing.length) {
        await tx
          .delete(productOptionValues)
          .where(inArray(productOptionValues.optionId, existing.map((o) => o.id)))
        await tx.delete(productOptions).where(eq(productOptions.productId, productId))
      }

      for (const [i, o] of input.entries()) {
        const perValueQuantity = o.perValueQuantity ?? false
        const minSelections = clamp(o.minSelections ?? 1, 0, 99)
        const maxSelections = clamp(o.maxSelections ?? 1, 1, 99)
        if (minSelections > maxSelections) {
          throw badRequest('BAD_REQUEST', `Option "${o.name}" has min selections greater than max selections`)
        }
        const [opt] = await tx
          .insert(productOptions)
          .values({
            merchantId,
            productId,
            name: o.name,
            nameAr: o.nameAr ?? null,
            type: o.type ?? 'radio',
            required: o.required ?? false,
            minSelections,
            maxSelections,
            allowControl: { perValueQuantity, unlimited: o.unlimited ?? false },
            sortOrder: o.sortOrder ?? i,
            status: o.status ?? 'active'
          })
          .returning()
        for (const [j, v] of (o.values ?? []).entries()) {
          await tx.insert(productOptionValues).values({
            merchantId,
            optionId: opt.id,
            value: v.value,
            valueAr: v.valueAr ?? null,
            priceAdjustment: v.priceAdjustment ?? 0,
            meta: v.meta ?? {},
            quantity: perValueQuantity ? clamp(v.quantity ?? 0, 0, 999999) : null,
            sortOrder: v.sortOrder ?? j,
            status: v.status ?? 'active'
          })
        }
      }
    })
    return this.listOptions(db, merchantId, productId)
  }

  /** Expand the cartesian product of active option values into variant rows.
   *  Existing variants matching a combination are kept untouched (their SKU,
   *  price, inventory survive); only missing combinations are created. */
  static async generateVariants(db: DB, merchantId: string, productId: string) {
    const product = await this.findProduct(db, merchantId, productId)
    if (!product) throw notFound('NOT_FOUND', 'Product not found')

    const opts = await db
      .select()
      .from(productOptions)
      .where(and(eq(productOptions.productId, productId), eq(productOptions.status, 'active')))
      .orderBy(asc(productOptions.sortOrder), asc(productOptions.createdAt))
    if (!opts.length) return ok({ items: [], created: 0 })

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

    let combos: Array<Record<string, string>> = [{}]
    for (const opt of opts) {
      const optsValues = values.filter((v) => v.optionId === opt.id)
      if (!optsValues.length) continue
      const next: Array<Record<string, string>> = []
      for (const combo of combos) {
        for (const v of optsValues) next.push({ ...combo, [opt.name]: v.value })
      }
      combos = next
    }

    // Arabic labels for each combination, resolved from the option valueAr map.
    const valueArByOption = new Map<string, Map<string, string>>()
    const qtyByOption = new Map<string, Map<string, number>>()
    const perValueQtyByOption = new Map<string, boolean>()
    for (const opt of opts) {
      const arMap = new Map<string, string>()
      const qtyMap = new Map<string, number>()
      for (const v of values.filter((row) => row.optionId === opt.id)) {
        if (v.valueAr) arMap.set(v.value, v.valueAr)
        if (v.quantity !== null && v.quantity !== undefined) qtyMap.set(v.value, v.quantity)
      }
      valueArByOption.set(opt.name, arMap)
      qtyByOption.set(opt.name, qtyMap)
      perValueQtyByOption.set(
        opt.name,
        (opt.allowControl as { perValueQuantity?: boolean } | null)?.perValueQuantity ?? false
      )
    }
    const optionValuesArFor = (combo: Record<string, string>) => {
      const ar: Record<string, string> = {}
      for (const [name, value] of Object.entries(combo)) {
        const label = valueArByOption.get(name)?.get(value)
        if (label) ar[name] = label
      }
      return ar
    }
    const inventoryFor = (combo: Record<string, string>) => {
      let seed = 0
      let seeded = false
      for (const [name, value] of Object.entries(combo)) {
        if (!perValueQtyByOption.get(name)) continue
        seed += qtyByOption.get(name)?.get(value) ?? 0
        seeded = true
      }
      return seeded ? seed : 0
    }

    const existing = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productId))
    const have = new Set(existing.map((v) => JSON.stringify(v.optionValues ?? {})))
    const toInsert = combos
      .filter((c) => !have.has(JSON.stringify(c)))
      .map((c) => ({
        productId,
        sku: null,
        optionValues: c,
        optionValuesAr: optionValuesArFor(c),
        price: product.price,
        compareAtPrice: null,
        inventory: inventoryFor(c),
        unlimited: false,
        image: null
      }))

    let created = 0
    if (toInsert.length) {
      created = (
        await db.transaction((tx) => tx.insert(productVariants).values(toInsert).returning())
      ).length
    }
    const all = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productId))
    return ok({ items: all, created })
  }

  static async addVariant(
    db: DB,
    merchantId: string,
    productId: string,
    input: {
      sku?: string
      optionValues?: Record<string, string>
      optionValuesAr?: Record<string, string>
      price?: number
      compareAtPrice?: number
      inventory?: number
      unlimited?: boolean
      image?: string
    }
  ) {
    const product = await this.findProduct(db, merchantId, productId)
    if (!product) throw notFound('NOT_FOUND', 'Product not found')
    if ((input.inventory ?? 0) < 0) throw badRequest('BAD_REQUEST', 'Variant inventory cannot be negative')
    assertValidSalePrice(input.price ?? product.price, input.compareAtPrice)
    const [variant] = await db.transaction(async (tx) =>
      tx
        .insert(productVariants)
        .values({
          productId,
          sku: input.sku ?? null,
          optionValues: input.optionValues ?? {},
          optionValuesAr: input.optionValuesAr ?? {},
          price: input.price ?? product.price,
          compareAtPrice: input.compareAtPrice ?? null,
          inventory: input.inventory ?? 0,
          unlimited: input.unlimited ?? false,
          image: input.image ?? null
        })
        .returning()
    )
    return ok(variant)
  }

  static async updateVariant(
    db: DB,
    merchantId: string,
    variantId: string,
    input: {
      sku?: string
      optionValues?: Record<string, string>
      optionValuesAr?: Record<string, string>
      price?: number
      compareAtPrice?: number
      inventory?: number
      unlimited?: boolean
      image?: string
    }
  ) {
    const found = await this.findVariant(db, merchantId, variantId)
    if (!found) throw notFound('NOT_FOUND', 'Variant not found')
    const { variant } = found
    if ((input.inventory ?? variant.inventory) < 0) {
      throw badRequest('BAD_REQUEST', 'Variant inventory cannot be negative')
    }
    assertValidSalePrice(
      input.price ?? variant.price,
      input.compareAtPrice !== undefined ? input.compareAtPrice : variant.compareAtPrice
    )

    const values: Partial<NewProductVariant> = {}
    if (input.sku !== undefined) values.sku = input.sku ?? null
    if (input.optionValues !== undefined) values.optionValues = input.optionValues
    if (input.optionValuesAr !== undefined) values.optionValuesAr = input.optionValuesAr
    if (input.price !== undefined) values.price = input.price
    if (input.compareAtPrice !== undefined) values.compareAtPrice = input.compareAtPrice ?? null
    if (input.unlimited !== undefined) values.unlimited = input.unlimited
    if (input.image !== undefined) values.image = input.image ?? null

    if (Object.keys(values).length === 0) return ok(variant)

    const [updated] = input.inventory !== undefined && input.inventory !== variant.inventory
      ? await db.transaction(async (tx) => {
          values.inventory = input.inventory
          await tx.insert(inventoryLogs).values({
            merchantId,
            variantId: variant.id,
            change: input.inventory! - variant.inventory,
            beforeValue: variant.inventory,
            afterValue: input.inventory!,
            reason: 'adjustment',
            reference: 'variant-update'
          })
          return tx
            .update(productVariants)
            .set(values)
            .where(eq(productVariants.id, variantId))
            .returning()
        })
      : await db
          .update(productVariants)
          .set(values)
          .where(eq(productVariants.id, variantId))
          .returning()
    return ok(updated)
  }

  static async deleteVariant(db: DB, merchantId: string, variantId: string) {
    const found = await this.findVariant(db, merchantId, variantId)
    if (!found) throw notFound('NOT_FOUND', 'Variant not found')
    await db.delete(productVariants).where(eq(productVariants.id, variantId))
    return ok({ deleted: true })
  }

  /* ----------------------------- csv export ------------------------------ */

  static csvHeaders(): string[] {
    return [
      'sku',
      'name',
      'name_ar',
      'slug',
      'description',
      'description_ar',
      'price',
      'compare_at_price',
      'cost',
      'status',
      'category_slug',
      'track_inventory',
      'low_stock_threshold',
      'variant_sku',
      'option_values',
      'option_values_ar',
      'inventory',
      'visibility',
      'barcode',
      'tags',
      'gtin',
      'weight',
      'meta_title',
      'meta_description',
      'sale_starts_at',
      'sale_ends_at',
      'publish_at'
    ]
  }

  /** Header row + one sample data row for merchants building an import file. */
  static csvTemplate(): string {
    const sample = [
      'SAMPLE-SKU',
      'Sample T-Shirt',
      'تيشيرت عينة',
      'sample-t-shirt',
      'A soft cotton t-shirt.',
      'تيشيرت قطني ناعم.',
      '29.99',
      '39.99',
      '12',
      'active',
      'apparel',
      'true',
      '5',
      'SAMPLE-SKU-M',
      '{"Size":"M"}',
      '{}',
      '10',
      'both',
      '6281234567890',
      'summer|cotton',
      '6281234567890',
      '0.25',
      'Sample T-Shirt — Store',
      'Buy the soft Sample T-Shirt online.',
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      ''
    ]
    return toCsv(this.csvHeaders(), [sample])
  }

  static async exportCsv(db: DB, merchantId: string): Promise<string> {
    const productRows = await db
      .select()
      .from(products)
      .where(eq(products.merchantId, merchantId))
      .orderBy(asc(products.createdAt))
    const ids = productRows.map((p) => p.id)
    const variantRows = ids.length
      ? await db
          .select()
          .from(productVariants)
          .where(inArray(productVariants.productId, ids))
          .orderBy(asc(productVariants.createdAt))
      : []
    const catRows = await db.select().from(categories).where(eq(categories.merchantId, merchantId))
    const catSlugById = new Map(catRows.map((c) => [c.id, c.slug]))

    const variantsByProduct = new Map<string, typeof variantRows>()
    for (const v of variantRows) {
      variantsByProduct.set(v.productId, [...(variantsByProduct.get(v.productId) ?? []), v])
    }

    const headers = this.csvHeaders()

    const iso = (d: Date | string | null | undefined) =>
      d ? (d instanceof Date ? d.toISOString() : new Date(d).toISOString()) : ''

    const rows: unknown[][] = []
    for (const p of productRows) {
      const base = [
        p.sku ?? '',
        p.name,
        p.nameAr ?? '',
        p.slug,
        p.description,
        p.descriptionAr ?? '',
        p.price,
        p.compareAtPrice ?? '',
        p.cost,
        p.status,
        p.categoryId ? (catSlugById.get(p.categoryId) ?? '') : '',
        p.trackInventory,
        p.lowStockThreshold
      ]
      const tail = [
        (p as { visibility?: string }).visibility ?? 'both',
        (p as { barcode?: string | null }).barcode ?? '',
        ((p as { tags?: string[] }).tags ?? []).join('|'),
        (p as { gtin?: string | null }).gtin ?? '',
        (p as { weight?: number | string | null }).weight ?? '',
        (p as { metaTitle?: string | null }).metaTitle ?? '',
        (p as { metaDescription?: string | null }).metaDescription ?? '',
        iso((p as { saleStartsAt?: Date | null }).saleStartsAt),
        iso((p as { saleEndsAt?: Date | null }).saleEndsAt),
        iso((p as { publishAt?: Date | null }).publishAt)
      ]
      const vs = variantsByProduct.get(p.id) ?? []
      if (vs.length === 0) {
        rows.push([...base, '', '', '', '', ...tail])
      } else {
        for (const v of vs) {
          rows.push([
            ...base,
            v.sku ?? '',
            JSON.stringify(v.optionValues ?? {}),
            JSON.stringify(v.optionValuesAr ?? {}),
            v.inventory,
            ...tail
          ])
        }
      }
    }
    return toCsv(headers, rows)
  }

  /* ----------------------------- csv import ------------------------------ */

  static async importCsv(db: DB, merchantId: string, text: string, opts?: { dryRun?: boolean }) {
    const dryRun = opts?.dryRun ?? false
    const parsed = parseCsv(text)
    if (parsed.length < 2) {
      throw badRequest('BAD_REQUEST', 'CSV needs a header row and at least one data row')
    }
    const header = parsed[0].map((h) => h.trim().toLowerCase())
    const col = (name: string) => header.indexOf(name)
    if (col('name') === -1) throw badRequest('BAD_REQUEST', 'CSV must include a "name" column')

    // Group data rows into product blocks keyed by the parent SKU column.
    const blocks = new Map<string, Array<{ line: number; cells: string[] }>>()
    for (let i = 1; i < parsed.length; i++) {
      const cells = parsed[i]
      const sku = col('sku') !== -1 ? (cells[col('sku')] ?? '').trim() : ''
      const key = sku || `__line_${i + 1}`
      const bucket = blocks.get(key) ?? []
      bucket.push({ line: i + 1, cells })
      blocks.set(key, bucket)
    }

    const catRows = await db
      .select({ id: categories.id, slug: categories.slug })
      .from(categories)
      .where(eq(categories.merchantId, merchantId))
    const catBySlug = new Map(catRows.map((c) => [c.slug, c.id]))

    const errors: Array<{ line: number; message: string }> = []
    let created = 0
    let updated = 0

    class RowError extends Error {}

    const num = (cells: string[], name: string): number | null => {
      const idx = col(name)
      if (idx === -1) return null
      const raw = (cells[idx] ?? '').trim()
      if (raw === '') return null
      const n = Number(raw)
      if (!Number.isFinite(n)) throw new RowError(`Invalid number in "${name}": ${raw}`)
      return n
    }
    const str = (cells: string[], name: string): string | undefined => {
      const idx = col(name)
      if (idx === -1) return undefined
      return (cells[idx] ?? '').trim()
    }

    for (const [, lines] of blocks) {
      try {
        const first = lines[0]
        const name = str(first.cells, 'name')
        if (!name) throw new RowError('Missing required "name"')
        const price = num(first.cells, 'price')
        if (price === null || price < 0) throw new RowError('"price" must be a non-negative number')

        const statusRaw = str(first.cells, 'status')
        const status =
          statusRaw && ['active', 'draft', 'archived'].includes(statusRaw) ? statusRaw : 'active'
        const trackInventoryRaw = str(first.cells, 'track_inventory')?.toLowerCase()
        const trackInventory =
          trackInventoryRaw === undefined ? undefined : ['true', '1', 'yes'].includes(trackInventoryRaw)
        const lowStockThreshold = num(first.cells, 'low_stock_threshold')
        const compareAtPrice = num(first.cells, 'compare_at_price')
        const cost = num(first.cells, 'cost')
        const description = str(first.cells, 'description')
        const descriptionAr = str(first.cells, 'description_ar')
        const nameAr = str(first.cells, 'name_ar')
        const categorySlug = str(first.cells, 'category_slug')
        let categoryId: string | null | undefined
        if (categorySlug !== undefined) {
          categoryId = categorySlug ? (catBySlug.get(categorySlug) ?? null) : null
        }
        const visibilityRaw = str(first.cells, 'visibility')?.toLowerCase()
        const visibility =
          visibilityRaw && ['both', 'pos', 'website'].includes(visibilityRaw) ? visibilityRaw : undefined
        if (header.includes('visibility') && str(first.cells, 'visibility') && !visibility) {
          throw new RowError('"visibility" must be one of both | pos | website')
        }
        const barcode = str(first.cells, 'barcode')
        const tagsRaw = str(first.cells, 'tags')
        const tags =
          tagsRaw === undefined
            ? undefined
            : tagsRaw
                .split('|')
                .map((t) => t.trim())
                .filter(Boolean)
        const gtin = str(first.cells, 'gtin')
        if (gtin && gtin.length > 32) throw new RowError('"gtin" must be at most 32 characters')
        const weight = num(first.cells, 'weight')
        if (weight !== null && weight < 0) throw new RowError('"weight" must be a non-negative number')
        const metaTitle = str(first.cells, 'meta_title')
        const metaDescription = str(first.cells, 'meta_description')
        const date = (cells: string[], name: string): Date | null | undefined => {
          const idx = col(name)
          if (idx === -1) return undefined
          const raw = (cells[idx] ?? '').trim()
          if (raw === '') return null
          const d = new Date(raw)
          if (Number.isNaN(d.getTime())) throw new RowError(`Invalid date in "${name}": ${raw}`)
          return d
        }
        const saleStartsAt = date(first.cells, 'sale_starts_at')
        const saleEndsAt = date(first.cells, 'sale_ends_at')
        const publishAt = date(first.cells, 'publish_at')
        if (saleStartsAt && saleEndsAt && saleEndsAt < saleStartsAt) {
          throw new RowError('"sale_ends_at" must be after "sale_starts_at"')
        }

        const sku = str(first.cells, 'sku') || null
        let existing: typeof products.$inferSelect | undefined
        if (sku) {
          ;[existing] = await db
            .select()
            .from(products)
            .where(and(eq(products.merchantId, merchantId), eq(products.sku, sku)))
        }

        // One transaction per product block: the product upsert AND all its
        // variant writes commit or roll back together — a mid-block failure can
        // no longer leave a half-imported product (P1-04).
        // With ?dryRun=1 nothing is written: rows are validated only and the
        // would-be created/updated tallies are returned.
        const validateVariantRows = () => {
          for (const { cells } of lines) {
            for (const key of ['option_values', 'option_values_ar'] as const) {
              const raw = str(cells, key)
              if (raw) {
                try {
                  const p = JSON.parse(raw)
                  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error()
                } catch {
                  throw new RowError(`Invalid ${key} JSON on a "${name}" row`)
                }
              }
            }
            const inv = num(cells, 'inventory')
            if (inv !== null && inv < 0) {
              throw new RowError(`"inventory" cannot be negative on a "${name}" row`)
            }
          }
        }

        if (dryRun) {
          validateVariantRows()
          if (existing) updated++
          else created++
          continue
        }

        const productId = await db.transaction(async (tx) => {
          if (existing) {
            const patch: Partial<typeof products.$inferInsert> = {}
            if (header.includes('name')) patch.name = name
            if (header.includes('name_ar') && nameAr !== undefined) patch.nameAr = nameAr || null
            if (header.includes('slug') && str(first.cells, 'slug')) patch.slug = slugify(str(first.cells, 'slug')!)
            if (header.includes('description') && description !== undefined) patch.description = description
            if (header.includes('description_ar') && descriptionAr !== undefined) patch.descriptionAr = descriptionAr ?? ''
            if (price !== null) patch.price = price
            if (header.includes('compare_at_price')) patch.compareAtPrice = compareAtPrice
            if (cost !== null) patch.cost = cost
            if (statusRaw !== undefined) patch.status = status
            if (categoryId !== undefined) patch.categoryId = categoryId
            if (trackInventory !== undefined) patch.trackInventory = trackInventory
            if (lowStockThreshold !== null) patch.lowStockThreshold = lowStockThreshold ?? 5
            if (visibility !== undefined) patch.visibility = visibility as 'both' | 'pos' | 'website'
            if (header.includes('barcode') && barcode !== undefined) patch.barcode = barcode || null
            if (tags !== undefined) patch.tags = tags
            if (header.includes('gtin') && gtin !== undefined) patch.gtin = gtin || null
            if (weight !== null) patch.weight = weight
            if (header.includes('meta_title') && metaTitle !== undefined) patch.metaTitle = metaTitle || null
            if (header.includes('meta_description') && metaDescription !== undefined) patch.metaDescription = metaDescription || null
            if (saleStartsAt !== undefined) patch.saleStartsAt = saleStartsAt
            if (saleEndsAt !== undefined) patch.saleEndsAt = saleEndsAt
            if (publishAt !== undefined) patch.publishAt = publishAt
            if (Object.keys(patch).length > 0) {
              await tx.update(products).set(patch).where(eq(products.id, existing!.id))
            }
            updated++
            return existing!.id
          }

          const [inserted] = await tx
            .insert(products)
            .values({
              merchantId,
              sku,
              name,
              nameAr: nameAr || null,
              slug: await this.uniqueSlug(tx as unknown as DB, merchantId, name),
              description: description ?? '',
              descriptionAr: descriptionAr ?? '',
              price,
              compareAtPrice: compareAtPrice ?? null,
              cost: cost ?? 0,
              categoryId: categoryId ?? null,
              trackInventory: trackInventory ?? false,
              lowStockThreshold: lowStockThreshold ?? 5,
              status,
              visibility: (visibility ?? 'both') as 'both' | 'pos' | 'website',
              barcode: barcode || null,
              tags: tags ?? [],
              gtin: gtin || null,
              weight: weight ?? null,
              metaTitle: metaTitle || null,
              metaDescription: metaDescription || null,
              saleStartsAt: saleStartsAt ?? null,
              saleEndsAt: saleEndsAt ?? null,
              publishAt: publishAt ?? null
            })
            .returning()
          created++
          return inserted.id
        })

        /* variants: upsert by variant_sku within the product (never deletes) */
        if (col('variant_sku') !== -1 || col('inventory') !== -1) {
          const existingVariants = await db
            .select()
            .from(productVariants)
            .where(eq(productVariants.productId, productId))
          const bySku = new Map(
            existingVariants.filter((v) => v.sku).map((v) => [v.sku as string, v])
          )

          for (const { cells } of lines) {
            const vSku = str(cells, 'variant_sku') || null
            const ovRaw = str(cells, 'option_values')
            const ovArRaw = str(cells, 'option_values_ar')
            let optionValues: Record<string, string> | undefined
            if (ovRaw) {
              try {
                const parsedOv = JSON.parse(ovRaw)
                if (parsedOv && typeof parsedOv === 'object' && !Array.isArray(parsedOv)) {
                  optionValues = parsedOv
                }
              } catch {
                throw new RowError(`Invalid option_values JSON on a "${name}" row`)
              }
            }
            let optionValuesAr: Record<string, string> | undefined
            if (ovArRaw) {
              try {
                const parsedOvAr = JSON.parse(ovArRaw)
                if (parsedOvAr && typeof parsedOvAr === 'object' && !Array.isArray(parsedOvAr)) {
                  optionValuesAr = parsedOvAr
                }
              } catch {
                throw new RowError(`Invalid option_values_ar JSON on a "${name}" row`)
              }
            }
            const vPrice = num(cells, 'price')
            const inventoryRaw = num(cells, 'inventory')
            if (inventoryRaw !== null && inventoryRaw < 0) {
              throw new RowError(`"inventory" cannot be negative on a "${name}" row`)
            }
            const inventory =
              inventoryRaw === null ? undefined : Math.max(0, Math.floor(inventoryRaw))

            const match = vSku ? bySku.get(vSku) : undefined
            if (match) {
              const pricePatch: Partial<typeof productVariants.$inferInsert> = {}
              if (vPrice !== null) pricePatch.price = vPrice
              if (optionValues !== undefined) pricePatch.optionValues = optionValues
              if (optionValuesAr !== undefined) pricePatch.optionValuesAr = optionValuesAr
              const inventoryChanged =
                inventory !== undefined && inventory !== match.inventory
              if (inventoryChanged || Object.keys(pricePatch).length > 0) {
                // Absolute inventory goes through the locked helper so a
                // concurrent sale between the earlier read and this write is
                // never lost; price/option updates ride the same transaction.
                await db.transaction(async (tx) => {
                  if (pricePatch.price !== undefined || pricePatch.optionValues !== undefined || pricePatch.optionValuesAr !== undefined) {
                    await tx
                      .update(productVariants)
                      .set(pricePatch)
                      .where(eq(productVariants.id, match.id))
                  }
                  if (inventoryChanged) {
                    await setVariantInventoryTx(tx, merchantId, match.id, inventory!, {
                      reason: 'import',
                      reference: 'csv-import'
                    })
                  }
                })
              }
            } else {
              await db.insert(productVariants).values({
                productId,
                sku: vSku,
                optionValues: optionValues ?? {},
                optionValuesAr: optionValuesAr ?? {},
                price: vPrice ?? price,
                compareAtPrice:
                  header.includes('compare_at_price') ? (compareAtPrice ?? null) : null,
                inventory: inventory ?? 0
              })
            }
          }
        }
      } catch (e) {
        errors.push({ line: lines[0].line, message: e instanceof Error ? e.message : 'Import failed' })
      }
    }

    return ok({ created, updated, failed: errors.length, errors, dryRun })
  }
}
