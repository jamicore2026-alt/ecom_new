import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import type { DB } from '../../database/client'
import { customers, emailLogs, merchants, orderItems, orders, products, reviewReplies, reviews, storeSettings } from '../../database/schema'
import { ok } from '../../shared/response'
import { badRequest, notFound } from '../../shared/errors'
import { makeMeta, parsePagination } from '../../shared/pagination'
import { getMailer, renderEmail } from '../../shared/mailer'
import { createLogger } from '../../shared/logger'

const log = createLogger('reviews')

/**
 * Helpful-vote limitation (documented): there is no helpful-votes ledger table
 * in the schema and schema edits are out of scope, so per-customer uniqueness
 * is enforced best-effort via a short-lived in-process guard (one vote per
 * customer+review per 24h per instance) plus rate-limiting at the gateway.
 * True cross-instance uniqueness would need a `review_helpful_votes` table —
 * tracked as a follow-up. Counts remain accurate (atomic increment).
 */
const helpfulGuard = new Map<string, number>()
const HELPFUL_GUARD_TTL_MS = 24 * 60 * 60 * 1000

const helpfulAllowed = (customerId: string | null, reviewId: string): boolean => {
  if (!customerId) return true
  const key = `${customerId}:${reviewId}`
  const last = helpfulGuard.get(key)
  if (last && Date.now() - last < HELPFUL_GUARD_TTL_MS) return false
  helpfulGuard.set(key, Date.now())
  if (helpfulGuard.size > 10000) {
    const cutoff = Date.now() - HELPFUL_GUARD_TTL_MS
    for (const [k, v] of helpfulGuard) if (v < cutoff) helpfulGuard.delete(k)
  }
  return true
}

export class ReviewsService {
  static async list(
    db: DB,
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
        images: reviews.images,
        helpfulCount: reviews.helpfulCount,
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

    // Attach merchant replies (the same thread doubles as the product Q&A —
    // shoppers' questions arrive as reviews with status pending and merchant
    // answers are replies; documented behaviour, no separate Q&A table).
    const ids = rows.map((r) => r.id)
    const repliesByReview = new Map<string, Array<typeof reviewReplies.$inferSelect>>()
    if (ids.length > 0) {
      const replies = await db
        .select()
        .from(reviewReplies)
        .where(and(eq(reviewReplies.merchantId, merchantId), inArray(reviewReplies.reviewId, ids)))
        .orderBy(desc(reviewReplies.createdAt))
      for (const r of replies) {
        const list = repliesByReview.get(r.reviewId) ?? []
        list.push(r)
        repliesByReview.set(r.reviewId, list)
      }
    }

    return ok({
      items: rows.map((r) => ({ ...r, replies: repliesByReview.get(r.id) ?? [] })),
      meta: makeMeta(page, limit, Number(total))
    })
  }

  static async update(db: DB, merchantId: string, id: string, body: { status: string }) {
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

  static async remove(db: DB, merchantId: string, id: string) {
    const [deleted] = await db
      .delete(reviews)
      .where(and(eq(reviews.id, id), eq(reviews.merchantId, merchantId)))
      .returning({ id: reviews.id })
    if (!deleted) throw notFound('NOT_FOUND', 'Review not found')
    return ok({ id: deleted.id, deleted: true })
  }

  /** Bulk moderate: approve/reject/reset many reviews in one call. */
  static async bulkModerate(db: DB, merchantId: string, ids: string[], status: string) {
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      throw badRequest('INVALID_STATUS', 'Status must be pending, approved or rejected')
    }
    const clean = [...new Set(ids.filter(Boolean))].slice(0, 200)
    if (clean.length === 0) throw badRequest('BAD_REQUEST', 'At least one review id is required')
    const updated = await db
      .update(reviews)
      .set({ status: status as 'pending' | 'approved' | 'rejected' })
      .where(and(eq(reviews.merchantId, merchantId), inArray(reviews.id, clean)))
      .returning({ id: reviews.id })
    return ok({ updated: updated.length, ids: updated.map((r) => r.id) })
  }

  /** Mark a review helpful (atomic increment; see module limitation note). */
  static async markHelpful(db: DB, merchantId: string, id: string, customerId?: string | null) {
    const [existing] = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.id, id), eq(reviews.merchantId, merchantId)))
    if (!existing) throw notFound('NOT_FOUND', 'Review not found')
    if (!helpfulAllowed(customerId ?? null, id)) {
      throw badRequest('ALREADY_VOTED', 'You have already marked this review as helpful')
    }
    const [updated] = await db
      .update(reviews)
      .set({ helpfulCount: sql`${reviews.helpfulCount} + 1` })
      .where(eq(reviews.id, id))
      .returning()
    return ok(updated)
  }

  /* ------------------------------ merchant replies ----------------------------- */

  /** Post a merchant reply on a review (thread doubles as product Q&A). */
  static async addReply(
    db: DB,
    merchantId: string,
    reviewId: string,
    body: string,
    createdBy?: string | null
  ) {
    const text = body?.trim()
    if (!text) throw badRequest('BAD_REQUEST', 'Reply body is required')
    if (text.length > 5000) throw badRequest('BAD_REQUEST', 'Reply is too long (max 5000 chars)')
    const [review] = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.id, reviewId), eq(reviews.merchantId, merchantId)))
    if (!review) throw notFound('NOT_FOUND', 'Review not found')
    const [reply] = await db
      .insert(reviewReplies)
      .values({ merchantId, reviewId, body: text, createdBy: createdBy ?? null })
      .returning()
    return ok(reply)
  }

  static async listReplies(db: DB, merchantId: string, reviewId: string) {
    const [review] = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.id, reviewId), eq(reviews.merchantId, merchantId)))
    if (!review) throw notFound('NOT_FOUND', 'Review not found')
    const rows = await db
      .select()
      .from(reviewReplies)
      .where(and(eq(reviewReplies.merchantId, merchantId), eq(reviewReplies.reviewId, reviewId)))
      .orderBy(desc(reviewReplies.createdAt))
    return ok({ items: rows })
  }

  /* --------------------------- review-request emails --------------------------- */

  /**
   * Post-purchase review requests. Runs from the jobs worker (no checkout-core
   * changes): for paid orders older than `delayDays` with no review yet from
   * the ordering customer and no prior request logged (email_logs, template
   * 'review_request' — cast past the EmailTemplateId union since the template
   * list lives in schema.ts, which is out of scope), send a request email.
   * Skips opted-out customers. Returns the number of emails sent.
   */
  static async sendDueReviewRequests(db: DB, delayDays = 7, batchLimit = 50): Promise<number> {
    const cutoff = new Date(Date.now() - delayDays * 24 * 60 * 60 * 1000)
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    const paidOrders = await db
      .select({
        id: orders.id,
        merchantId: orders.merchantId,
        customerId: orders.customerId,
        createdAt: orders.createdAt
      })
      .from(orders)
      .where(and(eq(orders.paymentStatus, 'paid'), gte(orders.createdAt, since)))
      .limit(500)

    const due = paidOrders.filter((o) => o.createdAt && o.createdAt <= cutoff && o.customerId)
    let sent = 0
    for (const order of due) {
      if (sent >= batchLimit) break
      try {
        const [alreadyLogged] = await db
          .select({ id: emailLogs.id })
          .from(emailLogs)
          .where(
            and(
              eq(emailLogs.merchantId, order.merchantId),
              eq(emailLogs.orderId, order.id),
              eq(emailLogs.template, 'review_request' as never)
            )
          )
        if (alreadyLogged) continue

        const [customer] = await db
          .select({ id: customers.id, email: customers.email, marketingOptOut: customers.marketingOptOut })
          .from(customers)
          .where(eq(customers.id, order.customerId as string))
        if (!customer || customer.marketingOptOut) continue

        const items = await db
          .select({ productId: orderItems.productId })
          .from(orderItems)
          .where(eq(orderItems.orderId, order.id))
        const productIds = [...new Set(items.map((i) => i.productId).filter(Boolean))] as string[]
        if (productIds.length === 0) continue

        const existing = await db
          .select({ id: reviews.id })
          .from(reviews)
          .where(
            and(
              eq(reviews.merchantId, order.merchantId),
              eq(reviews.customerId, customer.id),
              inArray(reviews.productId, productIds)
            )
          )
          .limit(1)
        if (existing.length > 0) continue

        const [merchant] = await db
          .select({ name: merchants.name })
          .from(merchants)
          .where(eq(merchants.id, order.merchantId))
        const [settings] = await db
          .select({ name: storeSettings.name })
          .from(storeSettings)
          .where(eq(storeSettings.merchantId, order.merchantId))
        const storeName = settings?.name ?? merchant?.name ?? 'Our store'
        const fromEmail = process.env.MAIL_FROM_FALLBACK ?? 'onboarding@resend.dev'
        const base = process.env.PUBLIC_STOREFRONT_URL ?? 'http://localhost:5479'
        const html = renderEmail({
          title: 'How was your order?',
          intro: `Thanks for shopping with ${storeName}! We'd love to hear what you thought — your review helps other shoppers.`,
          storeName,
          cta: { label: 'Write a review', url: `${base}/account/orders` },
          footerNote: 'You received this because you made a purchase. Manage marketing emails in your account settings.'
        })
        const result = await getMailer().send({
          from: `${storeName} <${fromEmail}>`,
          to: customer.email,
          subject: `How was your ${storeName} order?`,
          html
        })
        await db.insert(emailLogs).values({
          merchantId: order.merchantId,
          orderId: order.id,
          toEmail: customer.email,
          template: 'review_request' as never,
          subject: `How was your ${storeName} order?`,
          status: result.ok ? 'sent' : 'failed',
          providerRef: result.id ?? null,
          error: result.error ?? null,
          sentAt: result.ok ? new Date() : null
        })
        if (result.ok) sent++
      } catch (e) {
        log.error('review request failed', { orderId: order.id, error: e })
      }
    }
    return sent
  }

  /** Approved-rating aggregates for a set of products (storefront summaries). */
  static async summaryFor(db: DB, merchantId: string, productIds: string[]) {
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
