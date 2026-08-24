import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../database/client'
import { customers, products, reviews } from '../../database/schema'
import { ok } from '../../shared/response'
import { badRequest, notFound } from '../../shared/errors'
import { makeMeta, parsePagination } from '../../shared/pagination'

export class ReviewsService {
  static async list(
    merchantId: string,
    q: { page?: string; limit?: string; status?: string; productId?: string; rating?: string }
  ) {
    const { page, limit, offset } = parsePagination(q)
    const conditions = [eq(reviews.merchantId, merchantId)]
    if (q.status) conditions.push(eq(reviews.status, q.status))
    if (q.productId) conditions.push(eq(reviews.productId, q.productId))
    if (q.rating) {
      const rating = Number(q.rating)
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw badRequest('INVALID_RATING', 'Rating must be between 1 and 5')
      }
      conditions.push(eq(reviews.rating, rating))
    }
    const where = and(...conditions)

    const [{ total }] = await db.select({ total: count() }).from(reviews).where(where)
    const rows = await db
      .select({
        id: reviews.id,
        productId: reviews.productId,
        productName: products.name,
        productSlug: products.slug,
        customerId: reviews.customerId,
        customerEmail: customers.email,
        authorName: reviews.authorName,
        rating: reviews.rating,
        title: reviews.title,
        body: reviews.body,
        status: reviews.status,
        createdAt: reviews.createdAt,
        updatedAt: reviews.updatedAt
      })
      .from(reviews)
      .leftJoin(products, eq(products.id, reviews.productId))
      .leftJoin(customers, eq(customers.id, reviews.customerId))
      .where(where)
      .orderBy(desc(reviews.createdAt))
      .limit(limit)
      .offset(offset)

    return ok({ items: rows, meta: makeMeta(page, limit, Number(total)) })
  }

  static async update(merchantId: string, id: string, body: { status: string }) {
    const [existing] = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.id, id), eq(reviews.merchantId, merchantId)))
    if (!existing) throw notFound('NOT_FOUND', 'Review not found')

    const [updated] = await db
      .update(reviews)
      .set({ status: body.status as 'pending' | 'approved' | 'rejected' })
      .where(eq(reviews.id, id))
      .returning()
    return ok(updated)
  }

  static async remove(merchantId: string, id: string) {
    const [deleted] = await db
      .delete(reviews)
      .where(and(eq(reviews.id, id), eq(reviews.merchantId, merchantId)))
      .returning({ id: reviews.id })
    if (!deleted) throw notFound('NOT_FOUND', 'Review not found')
    return ok({ id: deleted.id, deleted: true })
  }

  /** Approved-rating aggregates for a set of products (storefront summaries). */
  static async summaryFor(merchantId: string, productIds: string[]) {
    const map = new Map<string, { average: number; count: number }>()
    if (productIds.length === 0) return map
    const rows = await db
      .select({
        productId: reviews.productId,
        average: sql<string>`avg(${reviews.rating})`.as('average'),
        count: count()
      })
      .from(reviews)
      .where(
        and(
          eq(reviews.merchantId, merchantId),
          eq(reviews.status, 'approved'),
          inArray(reviews.productId, productIds)
        )
      )
      .groupBy(reviews.productId)
    for (const r of rows) {
      map.set(r.productId, { average: Math.round(Number(r.average ?? 0) * 10) / 10, count: Number(r.count) })
    }
    return map
  }
}
