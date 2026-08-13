import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm'
import { db } from '../../database/client'
import { categories, inventoryLogs, products, productVariants } from '../../database/schema'
import { makeMeta, parsePagination } from '../../shared/pagination'
import { ok } from '../../shared/response'
import { badRequest, notFound } from '../../shared/errors'
import type { NewProduct, NewProductVariant } from '../../database/schema'

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

export class ProductsService {
  /* ------------------------------- helpers ------------------------------- */

  private static async uniqueSlug(merchantId: string, base: string) {
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

  private static async categoryMap(ids: string[]) {
    if (!ids.length) return new Map<string, typeof categories.$inferSelect>()
    const rows = await db.select().from(categories).where(inArray(categories.id, ids))
    return new Map(rows.map((c) => [c.id, c]))
  }

  private static async enrich(rows: typeof products.$inferSelect[]) {
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
      [...new Set(rows.map((r) => r.categoryId).filter((v): v is string => !!v))]
    )
    return rows.map((p) => ({
      ...p,
      stock: Number(aggMap.get(p.id)?.stock ?? 0),
      variantCount: Number(aggMap.get(p.id)?.variantCount ?? 0),
      category: p.categoryId ? (catMap.get(p.categoryId) ?? null) : null
    }))
  }

  /* -------------------------------- products ------------------------------ */

  static async list(merchantId: string, q: ProductQuery) {
    const { page, limit, offset } = parsePagination(q)
    const conditions = [eq(products.merchantId, merchantId)]

    const search = q.search?.trim()
    if (search) {
      const cond = or(ilike(products.name, `%${search}%`), ilike(products.sku, `%${search}%`))
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

    return ok({ items: await this.enrich(rows), meta: makeMeta(page, limit, Number(total)) })
  }

  static async get(merchantId: string, id: string) {
    const [product] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.merchantId, merchantId)))
    if (!product) throw notFound('NOT_FOUND', 'Product not found')

    const variants = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, id))

    const [category] = product.categoryId
      ? await db.select().from(categories).where(eq(categories.id, product.categoryId))
      : []

    const stock = variants.reduce((sum, v) => sum + v.inventory, 0)
    return ok({
      ...product,
      variants,
      category: category ?? null,
      stock
    })
  }

  static async create(
    merchantId: string,
    input: {
      name: string
      sku?: string
      barcode?: string
      slug?: string
      description?: string
      price: number
      compareAtPrice?: number
      cost?: number
      categoryId?: string
      trackInventory?: boolean
      lowStockThreshold?: number
      status?: string
      variants?: Array<{
        sku?: string
        optionValues?: Record<string, string>
        price?: number
        compareAtPrice?: number
        inventory?: number
        image?: string
      }>
    }
  ) {
    if (input.variants?.some((v) => (v.inventory ?? 0) < 0)) {
      throw badRequest('BAD_REQUEST', 'Variant inventory cannot be negative')
    }
    if (input.categoryId) {
      const [cat] = await db
        .select()
        .from(categories)
        .where(and(eq(categories.id, input.categoryId), eq(categories.merchantId, merchantId)))
      if (!cat) throw badRequest('BAD_REQUEST', 'Category does not exist')
    }

    const slug = await this.uniqueSlug(merchantId, input.slug ?? input.name)
    const result = await db.transaction(async (tx) => {
      const [product] = await tx
        .insert(products)
        .values({
          merchantId,
          name: input.name,
          slug,
          sku: input.sku ?? null,
          barcode: input.barcode ?? null,
          description: input.description ?? '',
          price: input.price,
          compareAtPrice: input.compareAtPrice ?? null,
          cost: input.cost ?? 0,
          categoryId: input.categoryId ?? null,
          trackInventory: input.trackInventory ?? false,
          lowStockThreshold: input.lowStockThreshold ?? 5,
          status: input.status ?? 'active'
        })
        .returning()

      const variantInputs = input.variants?.length
        ? input.variants
        : [{ sku: input.sku, price: input.price }]
      const variants = await this.insertVariants(tx, product.id, variantInputs, input.price)
      return { product, variants }
    })

    const stock = result.variants.reduce((s: number, v: { inventory: number }) => s + v.inventory, 0)
    return ok({ ...result.product, variants: result.variants, category: null, stock })
  }

  private static async insertVariants(
    executor: any,
    productId: string,
    inputs: Array<{
      sku?: string
      optionValues?: Record<string, string>
      price?: number
      compareAtPrice?: number
      inventory?: number
      image?: string
    }>,
    defaultPrice: number
  ) {
    const values: NewProductVariant[] = inputs.map((v) => ({
      productId,
      sku: v.sku ?? null,
      optionValues: v.optionValues ?? {},
      price: v.price ?? defaultPrice,
      compareAtPrice: v.compareAtPrice ?? null,
      inventory: v.inventory ?? 0,
      image: v.image ?? null
    }))
    return executor.insert(productVariants).values(values).returning()
  }

  static async update(
    merchantId: string,
    id: string,
    input: Record<string, unknown>
  ) {
    const [product] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.merchantId, merchantId)))
    if (!product) throw notFound('NOT_FOUND', 'Product not found')

    if (input.categoryId) {
      const [cat] = await db
        .select()
        .from(categories)
        .where(and(eq(categories.id, input.categoryId as string), eq(categories.merchantId, merchantId)))
      if (!cat) throw badRequest('BAD_REQUEST', 'Category does not exist')
    }

    const slug = input.slug
      ? await this.uniqueSlug(merchantId, input.slug as string)
      : undefined

    const values: Partial<NewProduct> = {}
    for (const key of [
      'name',
      'sku',
      'barcode',
      'description',
      'price',
      'compareAtPrice',
      'cost',
      'categoryId',
      'trackInventory',
      'lowStockThreshold',
      'status'
    ] as const) {
      if (input[key] !== undefined) values[key] = input[key] as never
    }
    if (slug) values.slug = slug

    if (Object.keys(values).length === 0) {
      const variants = await db
        .select()
        .from(productVariants)
        .where(eq(productVariants.productId, id))
      return ok({ ...product, variants, category: null })
    }

    const [updated] = await db
      .update(products)
      .set(values)
      .where(and(eq(products.id, id), eq(products.merchantId, merchantId)))
      .returning()

    const variants = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, id))

    return ok({ ...updated, variants, category: null })
  }

  static async archive(merchantId: string, id: string) {
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

    return ok(updated)
  }

  static async bulkEdit(
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
          .set({ price: sql`round((${products.price} * ${multiplier})::numeric, 2)` })
          .where(where)
        break
      }
      case 'set_inventory': {
        const value = Math.max(0, Math.floor(Number(input.value) || 0))
        await db.transaction(async (tx) => {
          const variants = await tx
            .select()
            .from(productVariants)
            .where(inArray(productVariants.productId, ids))
          await tx
            .update(productVariants)
            .set({ inventory: value })
            .where(inArray(productVariants.productId, ids))
          if (variants.length) {
            await tx.insert(inventoryLogs).values(
              variants.map((v) => ({
                merchantId,
                variantId: v.id,
                change: value - v.inventory,
                beforeValue: v.inventory,
                afterValue: value,
                reason: 'adjustment',
                reference: 'bulk-edit'
              }))
            )
          }
        })
        break
      }
      default:
        throw badRequest('BAD_REQUEST', 'Unknown bulk action')
    }

    return ok({ updated: ids.length })
  }

  /* ------------------------------- categories ------------------------------ */

  static async listCategories(merchantId: string) {
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
    merchantId: string,
    input: { name: string; slug?: string; parentId?: string | null; image?: string; sortOrder?: number; status?: string }
  ) {
    if (input.parentId) {
      await this.assertCategoryParent(merchantId, input.parentId)
    }
    const slug = await this.uniqueCategorySlug(merchantId, input.slug ?? input.name)
    const [created] = await db
      .insert(categories)
      .values({
        merchantId,
        name: input.name,
        slug,
        parentId: input.parentId ?? null,
        image: input.image ?? null,
        sortOrder: input.sortOrder ?? 0,
        status: input.status ?? 'active'
      })
      .returning()
    return ok(created)
  }

  private static async uniqueCategorySlug(merchantId: string, base: string) {
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
    merchantId: string,
    id: string,
    input: { name?: string; slug?: string; parentId?: string | null; image?: string; sortOrder?: number; status?: string }
  ) {
    const [cat] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.merchantId, merchantId)))
    if (!cat) throw notFound('NOT_FOUND', 'Category not found')

    if (input.parentId !== undefined) {
      const newParent = input.parentId
      if (newParent && newParent !== cat.id) {
        await this.assertCategoryParent(merchantId, newParent, cat.id)
      } else if (newParent === cat.id) {
        throw badRequest('BAD_REQUEST', 'A category cannot be its own parent')
      }
    }

    const values: Record<string, unknown> = {}
    if (input.name !== undefined) values.name = input.name
    if (input.image !== undefined) values.image = input.image ?? null
    if (input.sortOrder !== undefined) values.sortOrder = input.sortOrder
    if (input.status !== undefined) values.status = input.status
    if (input.parentId !== undefined) values.parentId = input.parentId ?? null
    if (input.slug) values.slug = await this.uniqueCategorySlug(merchantId, input.slug)

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

  static async deleteCategory(merchantId: string, id: string) {
    const [cat] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.merchantId, merchantId)))
    if (!cat) throw notFound('NOT_FOUND', 'Category not found')

    await db.transaction(async (tx) => {
      await tx.update(products).set({ categoryId: null }).where(eq(products.categoryId, id))
      await tx.delete(categories).where(eq(categories.id, id))
    })
    return ok({ deleted: true })
  }

  /* -------------------------------- variants ------------------------------ */

  private static async findProduct(merchantId: string, productId: string) {
    const [p] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.merchantId, merchantId)))
    return p
  }

  private static async findVariant(merchantId: string, variantId: string) {
    const [v] = await db
      .select({ variant: productVariants, product: products })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(and(eq(productVariants.id, variantId), eq(products.merchantId, merchantId)))
    return v
  }

  static async listVariants(merchantId: string, productId: string) {
    const product = await this.findProduct(merchantId, productId)
    if (!product) throw notFound('NOT_FOUND', 'Product not found')
    const rows = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productId))
    return ok(rows)
  }

  static async addVariant(
    merchantId: string,
    productId: string,
    input: {
      sku?: string
      optionValues?: Record<string, string>
      price?: number
      compareAtPrice?: number
      inventory?: number
      image?: string
    }
  ) {
    const product = await this.findProduct(merchantId, productId)
    if (!product) throw notFound('NOT_FOUND', 'Product not found')
    if ((input.inventory ?? 0) < 0) throw badRequest('BAD_REQUEST', 'Variant inventory cannot be negative')
    const [variant] = await db.transaction(async (tx) =>
      tx
        .insert(productVariants)
        .values({
          productId,
          sku: input.sku ?? null,
          optionValues: input.optionValues ?? {},
          price: input.price ?? product.price,
          compareAtPrice: input.compareAtPrice ?? null,
          inventory: input.inventory ?? 0,
          image: input.image ?? null
        })
        .returning()
    )
    return ok(variant)
  }

  static async updateVariant(
    merchantId: string,
    variantId: string,
    input: {
      sku?: string
      optionValues?: Record<string, string>
      price?: number
      compareAtPrice?: number
      inventory?: number
      image?: string
    }
  ) {
    const found = await this.findVariant(merchantId, variantId)
    if (!found) throw notFound('NOT_FOUND', 'Variant not found')
    const { variant } = found
    if ((input.inventory ?? variant.inventory) < 0) {
      throw badRequest('BAD_REQUEST', 'Variant inventory cannot be negative')
    }

    const values: Partial<NewProductVariant> = {}
    if (input.sku !== undefined) values.sku = input.sku ?? null
    if (input.optionValues !== undefined) values.optionValues = input.optionValues
    if (input.price !== undefined) values.price = input.price
    if (input.compareAtPrice !== undefined) values.compareAtPrice = input.compareAtPrice ?? null
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

  static async deleteVariant(merchantId: string, variantId: string) {
    const found = await this.findVariant(merchantId, variantId)
    if (!found) throw notFound('NOT_FOUND', 'Variant not found')
    await db.delete(productVariants).where(eq(productVariants.id, variantId))
    return ok({ deleted: true })
  }
}
